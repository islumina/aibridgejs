import { afterEach, describe, expect, test, vi } from "vitest";
import {
  BridgeDisposedError,
  BridgeRemoteError,
  BridgeResetError,
  BridgeTimeoutError,
  createBridge,
} from "../src/index.js";
import { isValidEnvelope } from "../src/internal.js";
import { createMockAdapter } from "../src/mock/index.js";

afterEach(() => {
  vi.useRealTimers();
});

function autoReply(adapter: ReturnType<typeof createMockAdapter>): void {
  adapter.subscribe((envelope) => {
    if (envelope.kind !== "request") return;
    queueMicrotask(() => {
      adapter.receive({
        kind: "response",
        id: envelope.id,
        ok: true,
        payload: { echo: envelope.method },
        timestamp: Date.now(),
      });
    });
  });
}

describe("aibridgejs core gates", () => {
  test("call<T>() narrows the resolved type", async () => {
    type EchoResponse = { echo: string };
    const adapter = createMockAdapter();
    autoReply(adapter);
    const bridge = createBridge({ adapter });
    const result = await bridge.call<EchoResponse>("ping");
    // Type-level check — compilation fails if call<T>() returns Promise<unknown>:
    const echoed: string = result.echo;
    expect(echoed).toBe("ping");
  });

  test("gate 1: ready gating — call queues until ready resolves", async () => {
    const adapter = createMockAdapter();
    autoReply(adapter);
    const bridge = createBridge({ adapter });
    const result = await bridge.call("ping");
    expect(result).toEqual({ echo: "ping" });
  });

  test("gate 2: concurrent responses correlate by id", async () => {
    const adapter = createMockAdapter();
    autoReply(adapter);
    const bridge = createBridge({ adapter });
    const [a, b, c] = await Promise.all([
      bridge.call("alpha"),
      bridge.call("beta"),
      bridge.call("gamma"),
    ]);
    expect((a as { echo: string }).echo).toBe("alpha");
    expect((b as { echo: string }).echo).toBe("beta");
    expect((c as { echo: string }).echo).toBe("gamma");
  });

  test("gate 3: timeout rejects and clears pending entry", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter, timeoutMs: 1000 });

    const pending = bridge.call("silent");
    // Attach the rejection handler before advancing timers so the rejection
    // does not surface as an unhandled rejection during fake-timer ticks.
    const assertion = expect(pending).rejects.toBeInstanceOf(BridgeTimeoutError);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  test("BRG-R-02: timeoutMs <= 0 disables the per-call timeout (pinned behaviour)", async () => {
    // Documented contract (README / call() JSDoc): a non-positive timeoutMs
    // disables the per-call timer entirely — the call stays pending until it is
    // settled by a response, abort, reset, or dispose. This pins that behaviour
    // so a future "clamp to a minimum" change cannot land silently.
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    let settled = false;
    const pending = bridge
      .call("silent", undefined, { timeoutMs: 0, signal: controller.signal })
      .catch(() => {
        settled = true;
      });

    // No timer was armed: advancing well past any default must NOT settle it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);

    // The pending entry is still live and cancellable via the supplied signal.
    controller.abort(new Error("explicit cancel"));
    await pending;
    expect(settled).toBe(true);
    bridge.dispose();
  });

  test("BRG-R-02: negative timeoutMs also disables the per-call timeout", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter, timeoutMs: -1 });

    let settled = false;
    const pending = bridge.call("silent").catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);

    bridge.dispose();
    await pending;
    expect(settled).toBe(true);
  });

  test("gate 4: abort rejects and clears pending entry", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    const pending = bridge.call("silent", undefined, { signal: controller.signal });
    queueMicrotask(() => controller.abort(new Error("cancelled by user")));

    await expect(pending).rejects.toThrow("cancelled by user");
  });

  test("gate 5: malformed inbound is silently discarded", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const received: unknown[] = [];
    bridge.on("anything", (p) => received.push(p));

    adapter.receive({ not: "valid" } as never);
    adapter.receive(null as never);
    adapter.receive("garbage" as never);

    await new Promise((r) => setTimeout(r, 0));
    expect(received).toHaveLength(0);
  });

  test("gate 7: dispose rejects all pending calls with BridgeDisposedError", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });

    const a = bridge.call("a");
    const b = bridge.call("b");
    bridge.dispose();

    await expect(a).rejects.toBeInstanceOf(BridgeDisposedError);
    await expect(b).rejects.toBeInstanceOf(BridgeDisposedError);
  });
});

describe("aibridgejs additional correctness", () => {
  test("A1: pre-ready call and emit preserve FIFO order with shared ready gate", async () => {
    const adapter = createMockAdapter();
    const order: string[] = [];
    adapter.subscribe((envelope) => {
      if (envelope.kind === "request") {
        order.push(`req:${envelope.method}`);
        adapter.receive({
          kind: "response",
          id: envelope.id,
          ok: true,
          timestamp: Date.now(),
        });
      } else if (envelope.kind === "event") {
        order.push(`evt:${envelope.event}`);
      }
    });

    const bridge = createBridge({ adapter });
    const c1 = bridge.call("c1");
    const e1 = bridge.emit("e1");
    const c2 = bridge.call("c2");
    await Promise.all([c1, e1, c2]);

    expect(order).toEqual(["req:c1", "evt:e1", "req:c2"]);
  });

  test("A2: ready() with already-aborted signal rejects synchronously", async () => {
    const adapter = createMockAdapter();
    const readySpy = vi.spyOn(adapter, "ready");
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));

    await expect(bridge.ready({ signal: controller.signal })).rejects.toThrow("pre-cancelled");
    expect(readySpy).not.toHaveBeenCalled();
  });

  test("A3: call() with already-aborted signal rejects and registers no pending", async () => {
    const adapter = createMockAdapter();
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));

    await expect(bridge.call("x", undefined, { signal: controller.signal })).rejects.toThrow(
      "pre-cancelled",
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("A4: dispose mid-call rejects pending; late response cannot re-settle", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });

    let capturedId = "";
    adapter.subscribe((envelope) => {
      if (envelope.kind === "request") capturedId = envelope.id;
    });

    await bridge.ready();
    const pending = bridge.call("slow");
    // Yield long enough for bridge.call's continuation to register pending and post.
    await new Promise((r) => setTimeout(r, 0));
    expect(capturedId).not.toBe("");

    bridge.dispose();
    await expect(pending).rejects.toBeInstanceOf(BridgeDisposedError);

    // A late response after dispose is a no-op (mock adapter is disposed and
    // the bridge's subscriber was unsubscribed). Must not throw or re-settle.
    expect(() => {
      adapter.receive({
        kind: "response",
        id: capturedId,
        ok: true,
        timestamp: Date.now(),
      });
    }).not.toThrow();
  });

  test("A5: timeout and response in same tick settle exactly once", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.subscribe((envelope) => {
      if (envelope.kind === "request") {
        adapter.receive({
          kind: "response",
          id: envelope.id,
          ok: true,
          payload: "fast",
          timestamp: Date.now(),
        });
      }
    });

    const bridge = createBridge({ adapter, timeoutMs: 100 });

    let settled = 0;
    let outcome: "resolve" | "reject" | null = null;

    const settledChain = bridge
      .call("race")
      .then(() => {
        settled++;
        outcome = "resolve";
      })
      .catch(() => {
        settled++;
        outcome = "reject";
      });

    await vi.advanceTimersByTimeAsync(101);
    await settledChain;
    expect(settled).toBe(1);
    expect(outcome).toBe("resolve");
  });

  test("A6: reset rejects pending and re-arms ready", async () => {
    const adapter = createMockAdapter();
    const readySpy = vi.spyOn(adapter, "ready");
    const bridge = createBridge({ adapter });

    // Trigger ready once.
    await bridge.ready();
    expect(readySpy).toHaveBeenCalledTimes(1);

    const pending = bridge.call("doomed");
    bridge.reset();
    await expect(pending).rejects.toBeInstanceOf(BridgeResetError);

    // After reset, next call should trigger a new ready round-trip.
    autoReply(adapter);
    await bridge.call("again");
    expect(readySpy).toHaveBeenCalledTimes(2);
  });

  test("late adapter.ready() resolve after reset does not clobber the new ready's reject handle", async () => {
    // Regression for the round-2 review finding: the previous wrappedReject
    // cleared `readyReject` unconditionally on the success path, so a stale
    // adapter.ready() that resolved AFTER reset created a new readyPromise
    // would wipe the new round's reject handle, breaking subsequent reset().
    const adapter = createMockAdapter();
    let resolveOldReady: (() => void) | undefined;
    const originalReady = adapter.ready;
    let firstCall = true;
    adapter.ready = () => {
      if (firstCall) {
        firstCall = false;
        return new Promise<void>((r) => {
          resolveOldReady = r;
        });
      }
      // Subsequent rounds: also slow, so we can issue a second reset.
      return new Promise<void>(() => {});
    };
    const bridge = createBridge({ adapter });

    // Round 1: park on slow ready, then reset → BridgeResetError surfaces.
    const r1 = bridge.ready();
    bridge.reset();
    await expect(r1).rejects.toBeInstanceOf(BridgeResetError);

    // The old adapter.ready promise eventually resolves AFTER reset. This
    // must not clear the new round's readyReject.
    resolveOldReady?.();
    await new Promise((r) => setTimeout(r, 0)); // let the resolve callback run

    // Round 2: a new ready() must still be cancellable by reset().
    const r2 = bridge.ready();
    bridge.reset();
    await expect(r2).rejects.toBeInstanceOf(BridgeResetError);

    adapter.ready = originalReady;
    bridge.dispose();
  });

  test("reset rejects calls and ready waiters parked on a slow adapter.ready()", async () => {
    // Regression: previously reset() only cleared `pending` (entries written
    // AFTER ready resolved). Calls awaiting a slow adapter.ready() never
    // reached the pending map and stayed parked indefinitely past reset.
    const adapter = createMockAdapter();
    let resolveReady: (() => void) | undefined;
    const slowReady = new Promise<void>((r) => {
      resolveReady = r;
    });
    const originalReady = adapter.ready;
    adapter.ready = () => slowReady; // never resolves until we choose
    const bridge = createBridge({ adapter });

    const inFlightCall = bridge.call("stuck");
    const inFlightReady = bridge.ready();
    bridge.reset();
    await expect(inFlightCall).rejects.toBeInstanceOf(BridgeResetError);
    await expect(inFlightReady).rejects.toBeInstanceOf(BridgeResetError);

    // After reset, restore + try again; the stale resolve should not bleed
    // into the new round.
    adapter.ready = originalReady;
    autoReply(adapter);
    await bridge.call("recovered");
    resolveReady?.(); // settle the dangling old promise; harmless.
    bridge.dispose();
  });

  test("A7a: on() once + abort-first leaves no listener behind", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    let called = 0;

    bridge.on("ev", () => called++, { once: true, signal: controller.signal });
    controller.abort();

    adapter.receive({ kind: "event", event: "ev", timestamp: Date.now() });
    expect(called).toBe(0);
  });

  test("A7b: on() once + event-first removes listener and abort handler", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    let called = 0;

    bridge.on("ev", () => called++, { once: true, signal: controller.signal });
    adapter.receive({ kind: "event", event: "ev", timestamp: Date.now() });
    adapter.receive({ kind: "event", event: "ev", timestamp: Date.now() });
    expect(called).toBe(1);

    // Aborting after once-fire should be a no-op (no double-removal).
    expect(() => controller.abort()).not.toThrow();
  });

  test("A8: listener registered during dispatch is not invoked in same cycle", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    let outerCalls = 0;
    let innerCalls = 0;

    bridge.on("e", () => {
      outerCalls++;
      bridge.on("e", () => innerCalls++);
    });

    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(outerCalls).toBe(1);
    expect(innerCalls).toBe(0);

    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(outerCalls).toBe(2);
    expect(innerCalls).toBe(1);
  });

  test("A9: response ok:false rejects with BridgeRemoteError carrying code/message/detail", async () => {
    const adapter = createMockAdapter();
    adapter.subscribe((envelope) => {
      if (envelope.kind === "request") {
        adapter.receive({
          kind: "response",
          id: envelope.id,
          ok: false,
          error: { code: "E_AUTH", message: "Token expired", detail: { hint: "refresh" } },
          timestamp: Date.now(),
        });
      }
    });

    const bridge = createBridge({ adapter });
    try {
      await bridge.call("session.getToken");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeRemoteError);
      const err = e as BridgeRemoteError;
      expect(err.code).toBe("E_AUTH");
      expect(err.message).toBe("Token expired");
      expect(err.detail).toEqual({ hint: "refresh" });
    }
  });

  test("A9c: remote error whose message/code getter throws does not hang the call", async () => {
    // Regression: before the try/catch guard, a throwing getter escaped the
    // adapter callback and the call promise hung forever past its own timeout.
    const adapter = createMockAdapter();
    adapter.subscribe((envelope) => {
      if (envelope.kind !== "request") return;
      const badError = {};
      Object.defineProperty(badError, "message", {
        get() {
          throw new Error("getter exploded");
        },
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(badError, "code", {
        get() {
          throw new Error("getter exploded");
        },
        enumerable: true,
        configurable: true,
      });
      adapter.receive({
        kind: "response",
        id: envelope.id,
        ok: false,
        error: badError as never,
        timestamp: Date.now(),
      });
    });

    const bridge = createBridge({ adapter });
    const err = await bridge.call("boom").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeRemoteError);
    const remoteErr = err as BridgeRemoteError;
    // Must resolve promptly with the safe fallback strings, not hang.
    expect(remoteErr.message).toBe("Remote error");
    expect(remoteErr.code).toBe("REMOTE_ERROR");
  });

  test("A9d: poisoned ok:true response (throwing payload getter) settles the call (reject), does not hang", async () => {
    // Regression for BRG-S-01: the 0.5.1 try/catch guards only the ok:false
    // branch. On the success path `envelope.payload` was read AFTER
    // entry.cleanup() had cleared the timeout and removed the abort listener.
    // A throwing payload getter escaped the dispatch callback and the call
    // promise hung permanently (past its own timeout and beyond any abort).
    // The fix reads id/ok/payload once into locals inside a guarded region
    // before mutating `pending` / calling cleanup(), so the throw becomes a
    // deterministic reject of THIS pending call.
    const adapter = createMockAdapter();
    adapter.subscribe((envelope) => {
      if (envelope.kind !== "request") return;
      const poisoned: Record<string, unknown> = {
        kind: "response",
        id: envelope.id,
        ok: true,
        timestamp: Date.now(),
      };
      Object.defineProperty(poisoned, "payload", {
        get() {
          throw new Error("payload getter exploded");
        },
        enumerable: true,
        configurable: true,
      });
      adapter.receive(poisoned as never);
    });

    const bridge = createBridge({ adapter, timeoutMs: 50 });
    // If the call hangs, this await never settles and the test times out (RED).
    const outcome = await bridge.call("boom").then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
    expect(outcome).toBe("rejected");
    bridge.dispose();
  });

  test("A9e: poisoned ok:true read failure leaves no leaked timeout or abort listener", async () => {
    // BRG-S-01 (wiring intact after read failure): when the success-branch
    // read throws and rejects the call, the per-call timer and the caller's
    // abort listener must already be torn down — no orphaned setTimeout firing
    // later, no listener left on the signal.
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.subscribe((envelope) => {
      if (envelope.kind !== "request") return;
      const poisoned: Record<string, unknown> = {
        kind: "response",
        id: envelope.id,
        ok: true,
        timestamp: Date.now(),
      };
      Object.defineProperty(poisoned, "payload", {
        get() {
          throw new Error("payload getter exploded");
        },
        enumerable: true,
        configurable: true,
      });
      adapter.receive(poisoned as never);
    });

    const bridge = createBridge({ adapter, timeoutMs: 1000 });
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    let settled = 0;
    const chain = bridge.call("boom", undefined, { signal: controller.signal }).then(
      () => settled++,
      () => settled++,
    );
    await chain;
    // Rejected exactly once via the read-failure path.
    expect(settled).toBe(1);
    // The abort listener was detached by cleanup() before the reject surfaced.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    // No stray timer fires afterwards (would otherwise attempt a second settle
    // / touch a cleared entry). Advancing past the timeout must be inert.
    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).toBe(1);
    bridge.dispose();
  });

  test("A9f: response handler reads the envelope id exactly once (no get/delete desync vector)", async () => {
    // BRG-S-01 (id read-once): the buggy handler read `envelope.id` TWICE
    // inside the dispatch path — once for `pending.get(envelope.id)` and again
    // for `pending.delete(envelope.id)`. A getter returning different values
    // across those reads could delete the wrong key (leaking the real pending
    // entry) and misroute settlement. The fix captures the id once into a
    // local and reuses it for both get and delete.
    //
    // The id getter is also touched by `isValidEnvelope`, which validates this
    // response twice on the success path (mock dispatch validates, then the
    // bridge subscriber re-validates). To stay robust against the validator's
    // internal read count, we self-calibrate: measure how many id reads a
    // single isValidEnvelope() costs for this exact shape, then assert the
    // end-to-end count is `2 * perValidator + 1` — i.e. the handler adds
    // exactly ONE read. The pre-fix handler added two.
    const responseShape = (id: () => string): Record<string, unknown> => {
      const env: Record<string, unknown> = {
        kind: "response",
        ok: true,
        payload: { ok: true },
        timestamp: Date.now(),
      };
      Object.defineProperty(env, "id", { get: id, enumerable: true, configurable: true });
      return env;
    };

    // Calibrate: id reads per single validator pass on this shape.
    let calibrationReads = 0;
    isValidEnvelope(
      responseShape(() => {
        calibrationReads++;
        return "calib-id";
      }),
    );
    const perValidator = calibrationReads;
    expect(perValidator).toBeGreaterThan(0);

    const adapter = createMockAdapter();
    let realId = "";
    let reads = 0;
    adapter.subscribe((envelope) => {
      if (envelope.kind !== "request") return;
      realId = envelope.id;
      adapter.receive(
        responseShape(() => {
          reads++;
          return realId;
        }) as never,
      );
    });

    const bridge = createBridge({ adapter });
    const result = await bridge.call<{ ok: boolean }>("ping");
    expect(result).toEqual({ ok: true });
    // 2 validator passes (mock dispatch + bridge subscriber) + exactly 1
    // handler read. Pre-fix the handler read it twice → 2*perValidator + 2.
    expect(reads).toBe(2 * perValidator + 1);
    bridge.dispose();
  });

  test("A9b: remote error with non-string code/message coerces to safe string defaults", async () => {
    const adapter = createMockAdapter();
    adapter.subscribe((envelope) => {
      if (envelope.kind === "request") {
        adapter.receive({
          kind: "response",
          id: envelope.id,
          ok: false,
          // Malformed host: non-string code/message. BridgeRemoteError types
          // both as string, so the bridge must coerce rather than leak them.
          error: { code: 123, message: { not: "a string" } } as never,
          timestamp: Date.now(),
        });
      }
    });

    const bridge = createBridge({ adapter });
    try {
      await bridge.call("x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeRemoteError);
      const err = e as BridgeRemoteError;
      expect(err.code).toBe("REMOTE_ERROR");
      expect(err.message).toBe("Remote error");
    }
  });

  test("A10: reset detaches the per-round dispose listener from the internal signal", async () => {
    // Regression: repeated reset() against a hung adapter.ready() must not
    // accumulate orphaned "abort" listeners on the bridge's internal signal.
    // The reset path (wrappedReject) now removes the round's listener.
    const adapter = createMockAdapter();
    const capturedSignals: AbortSignal[] = [];
    adapter.ready = (signal?: AbortSignal) => {
      if (signal) capturedSignals.push(signal);
      return new Promise<void>(() => {}); // hangs; settled only via reset()
    };
    const bridge = createBridge({ adapter });

    const r1 = bridge.ready();
    const internalSignal = capturedSignals[0];
    if (!internalSignal) throw new Error("adapter.ready was not invoked");
    const removeSpy = vi.spyOn(internalSignal, "removeEventListener");

    bridge.reset();
    await expect(r1).rejects.toBeInstanceOf(BridgeResetError);
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    bridge.dispose();
  });

  test("inbound 'request' envelope is silently ignored (v0.1 scope)", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const received: unknown[] = [];
    bridge.on("never", (p) => received.push(p));

    adapter.receive({
      kind: "request",
      id: "x",
      method: "incoming.from.host",
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(0);
  });

  test("platform() returns adapter platform and throws after dispose", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    expect(bridge.platform()).toBe("mock");
    bridge.dispose();
    expect(() => bridge.platform()).toThrow(BridgeDisposedError);
  });

  test("dispose is idempotent", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    bridge.dispose();
    expect(() => bridge.dispose()).not.toThrow();
  });

  test("listener that throws does not affect siblings", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const calls: string[] = [];

    bridge.on("e", () => {
      throw new Error("boom");
    });
    bridge.on("e", () => {
      calls.push("ok");
    });

    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(calls).toEqual(["ok"]);
  });

  test("on() returns unsubscribe that removes listener idempotently", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    let calls = 0;

    const off = bridge.on("e", () => calls++);
    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(calls).toBe(1);

    off();
    off(); // idempotent
    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(calls).toBe(1);
  });

  test("emit awaits ready before posting", async () => {
    const adapter = createMockAdapter();
    const readySpy = vi.spyOn(adapter, "ready");
    const bridge = createBridge({ adapter });
    await bridge.emit("e", { x: 1 });
    expect(readySpy).toHaveBeenCalled();
  });

  test("call/emit reject and on/reset throw synchronously after dispose", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    bridge.dispose();
    await expect(bridge.call("x")).rejects.toBeInstanceOf(BridgeDisposedError);
    await expect(bridge.emit("x")).rejects.toBeInstanceOf(BridgeDisposedError);
    expect(() => bridge.on("x", () => {})).toThrow(BridgeDisposedError);
    expect(() => bridge.reset()).toThrow(BridgeDisposedError);
  });

  test("ready rejects when bridge is disposed mid-flight", async () => {
    const adapter = createMockAdapter();
    // Override ready to never resolve so we can dispose mid-flight.
    adapter.ready = () =>
      new Promise<void>(() => {
        /* never resolves */
      });
    const bridge = createBridge({ adapter });

    const pending = bridge.ready();
    bridge.dispose();
    await expect(pending).rejects.toBeInstanceOf(BridgeDisposedError);
  });

  test("ready({signal}) rejects when bridge is disposed before adapter readies", async () => {
    const adapter = createMockAdapter();
    adapter.ready = () => new Promise<void>(() => {});
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    const pending = bridge.ready({ signal: controller.signal });
    bridge.dispose();
    await expect(pending).rejects.toBeInstanceOf(BridgeDisposedError);
  });

  test("ready({signal}) rejects with the abort reason when the signal aborts mid-flight", async () => {
    // A2 covers the pre-aborted signal (synchronous reject before adapter.ready
    // is ever called). This covers the complementary path: adapter.ready() is
    // in flight (unsettled) when the user signal aborts, exercising the
    // onUserAbort handler in the user-signal wrapper of ready().
    const adapter = createMockAdapter();
    adapter.ready = () => new Promise<void>(() => {});
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    const pending = bridge.ready({ signal: controller.signal });
    const reason = new Error("aborted mid-ready");
    queueMicrotask(() => controller.abort(reason));

    await expect(pending).rejects.toBe(reason);

    bridge.dispose();
  });

  test("adapter.ready rejection propagates through bridge.ready({signal})", async () => {
    const adapter = createMockAdapter();
    adapter.ready = () => Promise.reject(new Error("adapter init failed"));
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    await expect(bridge.ready({ signal: controller.signal })).rejects.toThrow(
      "adapter init failed",
    );
  });

  test("adapter.ready resolving after dispose still ends in BridgeDisposedError", async () => {
    let resolveReady: () => void = () => {};
    const adapter = createMockAdapter();
    adapter.ready = () =>
      new Promise<void>((r) => {
        resolveReady = r;
      });
    const bridge = createBridge({ adapter });

    const pending = bridge.ready();
    bridge.dispose();
    resolveReady();
    await expect(pending).rejects.toBeInstanceOf(BridgeDisposedError);
  });

  test("call with signal aborting after pending registration rejects via abortHandler", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    await bridge.ready();
    const pending = bridge.call("silent", undefined, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort(new Error("aborted mid-call"));
    await expect(pending).rejects.toThrow("aborted mid-call");
  });

  test("call with signal that does not abort cleans up its abort listener on success", async () => {
    const adapter = createMockAdapter();
    adapter.subscribe((envelope) => {
      if (envelope.kind === "request") {
        adapter.receive({
          kind: "response",
          id: envelope.id,
          ok: true,
          payload: "done",
          timestamp: Date.now(),
        });
      }
    });
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    const result = await bridge.call("x", undefined, { signal: controller.signal });
    expect(result).toBe("done");
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("on() with already-aborted signal never registers a listener", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    bridge.on("ev", () => calls++, { signal: controller.signal });
    adapter.receive({ kind: "event", event: "ev", timestamp: Date.now() });
    expect(calls).toBe(0);
  });

  test("dispose unsubscribes all registered event listeners", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    let calls = 0;

    bridge.on("a", () => calls++);
    bridge.on("b", () => calls++);
    bridge.on("c", () => calls++, { signal: controller.signal });
    bridge.dispose();

    // Aborting the signal after dispose must be a no-op.
    expect(() => controller.abort()).not.toThrow();
  });

  test("reset clears event listeners and pending entries", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    let calls = 0;

    bridge.on("ev", () => calls++);
    await bridge.ready();

    bridge.reset();
    adapter.receive({ kind: "event", event: "ev", timestamp: Date.now() });
    expect(calls).toBe(0);
  });

  test("post() rejection propagates to call() rejection and clears pending", async () => {
    const adapter = createMockAdapter();
    const original = adapter.post;
    adapter.post = async (msg) => {
      // Simulate a transport-level failure.
      void msg;
      throw new Error("transport down");
    };
    const bridge = createBridge({ adapter });

    await expect(bridge.call("x")).rejects.toThrow("transport down");
    // Restore so dispose doesn't blow up.
    adapter.post = original;
    bridge.dispose();
  });
});
