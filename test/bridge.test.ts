import { afterEach, describe, expect, test, vi } from "vitest";
import {
  BridgeDisposedError,
  BridgeError,
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

  // timeoutMs range normalisation. setTimeout stores its delay as a signed
  // 32-bit int, so Infinity or anything above 2**31-1 used to overflow and fire
  // after ~1 ms (Node TimeoutOverflowWarning; browsers treat it as 0), and NaN
  // failed both `> 0` and `<= 0`, silently disabling the default timer.
  // Real timers here: the overflow is a host-timer behaviour fake timers do not
  // reproduce faithfully.
  const settleState = (p: Promise<unknown>): { value: unknown; done: Promise<void> } => {
    const state: { value: unknown; done: Promise<void> } = {
      value: null,
      done: Promise.resolve(),
    };
    state.done = p.then(
      () => {
        state.value = "resolved";
      },
      (err: unknown) => {
        state.value = err;
      },
    );
    return state;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("T1: call() timeoutMs: Infinity arms no timer instead of firing after ~1 ms", async () => {
    const bridge = createBridge({ adapter: createMockAdapter() });
    const state = settleState(bridge.call("x", undefined, { timeoutMs: Number.POSITIVE_INFINITY }));
    await wait(50);
    expect(state.value).toBeNull();
    bridge.dispose();
    await state.done;
    expect(state.value).toBeInstanceOf(BridgeDisposedError);
  });

  test("T2: call() timeoutMs above 2**31-1 is clamped instead of overflowing to ~1 ms", async () => {
    const bridge = createBridge({ adapter: createMockAdapter() });
    const state = settleState(bridge.call("x", undefined, { timeoutMs: 2 ** 31 }));
    await wait(50);
    expect(state.value).toBeNull();
    bridge.dispose();
    await state.done;
    expect(state.value).toBeInstanceOf(BridgeDisposedError);
  });

  test("T3: createBridge({ timeoutMs: Infinity }) does not fail every call immediately", async () => {
    const bridge = createBridge({
      adapter: createMockAdapter(),
      timeoutMs: Number.POSITIVE_INFINITY,
    });
    const state = settleState(bridge.call("x"));
    await wait(50);
    expect(state.value).toBeNull();
    bridge.dispose();
    await state.done;
  });

  test("T4: emit() timeoutMs: Infinity does not reject before post() settles", async () => {
    const adapter = createMockAdapter();
    adapter.post = () => new Promise<void>(() => {}); // hangs
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    const state = settleState(
      bridge.emit("e", undefined, {
        timeoutMs: Number.POSITIVE_INFINITY,
        signal: controller.signal,
      }),
    );
    await wait(50);
    expect(state.value).toBeNull();
    const reason = new Error("cancel");
    controller.abort(reason);
    await state.done;
    expect(state.value).toBe(reason);
    bridge.dispose();
  });

  test("T5: a NaN timeoutMs falls back to the default instead of disabling the timer", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter, timeoutMs: Number("abc") });
    const fromDefault = settleState(bridge.call("x"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await fromDefault.done;
    expect(fromDefault.value).toBeInstanceOf(BridgeTimeoutError);

    const bridge2 = createBridge({ adapter: createMockAdapter(), timeoutMs: 1000 });
    const perCall = settleState(bridge2.call("y", undefined, { timeoutMs: Number.NaN }));
    await vi.advanceTimersByTimeAsync(1000);
    await perCall.done;
    expect(perCall.value).toBeInstanceOf(BridgeTimeoutError);
    bridge.dispose();
    bridge2.dispose();
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
    // Regression for the round-2 review finding: a stale adapter.ready() that
    // resolved AFTER reset created a new readiness round used to wipe the new
    // round's handle, breaking subsequent reset(). Settling only clears the
    // live-round slot while it still points at the settling round.
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
    // must not clear the new round's handle.
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

  test("A8b: dispose() from a listener stops fan-out for later siblings, including once", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spyB = vi.fn();
    const spyC = vi.fn();
    bridge.on("e", () => bridge.dispose());
    bridge.on("e", spyB);
    bridge.on("e", spyC, { once: true });

    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });

    expect(spyB).not.toHaveBeenCalled();
    expect(spyC).not.toHaveBeenCalled();
  });

  test("A8c: a sibling unsubscribe() during dispatch skips that sibling this cycle", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spyB = vi.fn();
    // biome-ignore lint/style/useConst: hoisted so the listener closure can reference it before assignment
    let off: (() => void) | undefined;
    bridge.on("e", () => off?.());
    off = bridge.on("e", spyB);

    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(spyB).not.toHaveBeenCalled();

    // The listener is truly gone, not just skipped once.
    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(spyB).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("A8d: a sibling's signal abort during dispatch skips that sibling this cycle", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spyB = vi.fn();
    const ctrl = new AbortController();
    bridge.on("e", () => ctrl.abort());
    bridge.on("e", spyB, { signal: ctrl.signal });

    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(spyB).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("A8e: reset() from a listener does not cut the fan-out short (0.6.0: listeners survive reset)", () => {
    // 0.5.9 pinned the opposite: reset() removed every listener, so later
    // siblings were skipped. Since 0.6.0 only dispose() removes listeners.
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spyB = vi.fn();
    bridge.on("e", () => bridge.reset());
    bridge.on("e", spyB);

    adapter.receive({ kind: "event", event: "e", timestamp: Date.now() });
    expect(spyB).toHaveBeenCalledTimes(1);
    bridge.dispose();
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

  test("A10: reset detaches the bridge's own listener from the round signal", async () => {
    // Regression: repeated reset() against a hung adapter.ready() must not
    // accumulate orphaned "abort" listeners. Since 0.6.0 each readiness round
    // has its own signal; the bridge's listener on it is removed on settle.
    const adapter = createMockAdapter();
    const capturedSignals: AbortSignal[] = [];
    adapter.ready = (signal?: AbortSignal) => {
      if (signal) capturedSignals.push(signal);
      return new Promise<void>(() => {}); // hangs; settled only via reset()
    };
    const bridge = createBridge({ adapter });

    const r1 = bridge.ready();
    const roundSignal = capturedSignals[0];
    if (!roundSignal) throw new Error("adapter.ready was not invoked");
    const removeSpy = vi.spyOn(roundSignal, "removeEventListener");

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

  // ---------------------------------------------------------------------------
  // emit() per-call cancellation (REVIEW P2: "emit() cancellation").
  // emit() gains an OPTIONAL { signal, timeoutMs } third argument so a single
  // fire-and-forget event can be aborted or time-limited without resetting /
  // disposing the whole bridge. Mirrors call()'s signal/timeout conventions.
  // ---------------------------------------------------------------------------

  test("E1: emit() with a signal that aborts mid-flight rejects promptly with the abort reason", async () => {
    // adapter.post() hangs forever; the per-call signal must unstick emit().
    const adapter = createMockAdapter();
    adapter.post = () => new Promise<void>(() => {});
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    const pending = bridge.emit("evt", { x: 1 }, { signal: controller.signal });
    const reason = new Error("emit aborted mid-flight");
    queueMicrotask(() => controller.abort(reason));

    await expect(pending).rejects.toBe(reason);
    bridge.dispose();
  });

  test("E1b: emit() abort detaches its abort listener (no orphaned pending state)", async () => {
    const adapter = createMockAdapter();
    adapter.post = () => new Promise<void>(() => {});
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    const pending = bridge.emit("evt", undefined, { signal: controller.signal });
    controller.abort(new Error("cancel"));
    await pending.catch(() => {});

    // The abort listener registered for this emit must be torn down on settle.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    bridge.dispose();
  });

  test("E2: emit() with a per-call timeoutMs rejects with BridgeTimeoutError after the timeout", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.post = () => new Promise<void>(() => {}); // hangs
    const bridge = createBridge({ adapter });

    const pending = bridge.emit("evt", { x: 1 }, { timeoutMs: 1000 });
    // Attach the rejection assertion before advancing timers so the rejection
    // does not surface as an unhandled rejection during fake-timer ticks.
    const assertion = expect(pending).rejects.toBeInstanceOf(BridgeTimeoutError);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    bridge.dispose();
  });

  test("E2b: emit() per-call timer is cleared on a successful post (no late fire)", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    // Mock post resolves synchronously, so the timer must be cleared and never
    // fire — advancing past the timeout must not produce a late rejection.
    const bridge = createBridge({ adapter });

    let settled: "resolved" | "rejected" | null = null;
    const chain = bridge.emit("evt", { x: 1 }, { timeoutMs: 1000 }).then(
      () => {
        settled = "resolved";
      },
      () => {
        settled = "rejected";
      },
    );
    await chain;
    expect(settled).toBe("resolved");

    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe("resolved"); // unchanged — no late timer fire
    bridge.dispose();
  });

  test("E3: emit() with no option behaves as before — no timer, awaits ready, posts once", async () => {
    // With no option emit() arms NO timer (a hung post stays pending until
    // reset()/dispose() reclaims it) and still gates on ready() exactly once,
    // posting exactly once.
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    const readySpy = vi.spyOn(adapter, "ready");
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });

    await bridge.emit("evt", { x: 1 });
    expect(readySpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledTimes(1);

    // No per-call timeout was requested, so nothing is armed to fire later.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(postSpy).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  test("E3b: emit() with timeoutMs <= 0 disables the per-call timer (mirrors call())", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.post = () => new Promise<void>(() => {}); // hangs
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    let settled = false;
    const pending = bridge
      .emit("evt", undefined, { timeoutMs: 0, signal: controller.signal })
      .catch(() => {
        settled = true;
      });

    // Non-positive timeout arms no timer: advancing well past any default must
    // NOT settle it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);

    // Still cancellable via the supplied signal.
    controller.abort(new Error("explicit cancel"));
    await pending;
    expect(settled).toBe(true);
    bridge.dispose();
  });

  test("E4: emit() with an already-aborted signal rejects and never posts", async () => {
    // Mirrors A3 for call(): a pre-aborted signal short-circuits before any
    // adapter side effect.
    const adapter = createMockAdapter();
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));

    await expect(bridge.emit("evt", undefined, { signal: controller.signal })).rejects.toThrow(
      "pre-cancelled",
    );
    expect(postSpy).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("E5: emit() signal abort during the readiness wait rejects without posting", async () => {
    // The signal is threaded into ready(), so an abort while adapter.ready() is
    // still in flight unsticks emit() before it ever reaches post().
    const adapter = createMockAdapter();
    adapter.ready = () => new Promise<void>(() => {}); // never readies
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });
    const controller = new AbortController();

    const pending = bridge.emit("evt", undefined, { signal: controller.signal });
    const reason = new Error("aborted during ready");
    queueMicrotask(() => controller.abort(reason));

    await expect(pending).rejects.toBe(reason);
    expect(postSpy).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("E6: emit() timeoutMs also bounds a hung readiness wait (EmitOptions.timeoutMs contract)", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.ready = () => new Promise<void>(() => {}); // never readies
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });

    let settled: unknown = null;
    const pending = bridge.emit("e", undefined, { timeoutMs: 100 }).then(
      () => {
        settled = "resolved";
      },
      (err: unknown) => {
        settled = err;
      },
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(postSpy).not.toHaveBeenCalled();
    expect(settled).toBeInstanceOf(BridgeTimeoutError);
    expect((settled as Error).message).toBe("Emit timeout: e");
    bridge.dispose();
    await pending;
  });

  test("E6b: emit() timeoutMs + signal during readiness — abort still wins and nothing is left armed", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.ready = () => new Promise<void>(() => {}); // never readies
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    const pending = bridge.emit("e", undefined, { timeoutMs: 1000, signal: controller.signal });
    const reason = new Error("aborted during ready");
    const assertion = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await assertion;

    // Deadline timer cleared and the caller's signal listener detached on settle.
    expect(vi.getTimerCount()).toBe(0);
    expect(removeSpy).toHaveBeenCalledTimes(addSpy.mock.calls.length);
    expect(postSpy).not.toHaveBeenCalled();
    bridge.dispose();
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

  test("aibridgejs-12: ready() throws BridgeDisposedError synchronously after dispose, unlike call()/emit()", () => {
    // Unlike call() and emit(), which are `async function`s (so a throw
    // inside them is automatically turned into a rejected promise), ready()
    // is a plain function that calls throwIfDisposed() before returning any
    // promise at all. Code written as `bridge.ready().then(...).catch(...)`
    // therefore throws before `.catch` is ever attached, instead of being
    // caught by it. This is documented in README/STABILITY alongside
    // platform() (which has the same synchronous-throw shape and is already
    // covered by its own test above).
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    bridge.dispose();
    expect(() => bridge.ready()).toThrow(BridgeDisposedError);
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

  test("ready({signal}) resolves once the adapter is ready and detaches its abort listener", async () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    await expect(bridge.ready({ signal: controller.signal })).resolves.toBeUndefined();
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    bridge.dispose();
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

  test("reset keeps event listeners and rejects pending entries (0.6.0 contract)", async () => {
    // 0.5.9 pinned that reset() removed listeners; since 0.6.0 they survive
    // and only dispose() removes them.
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    let calls = 0;

    bridge.on("ev", () => calls++);
    await bridge.ready();
    const doomed = bridge.call("doomed");

    bridge.reset();
    await expect(doomed).rejects.toBeInstanceOf(BridgeResetError);
    adapter.receive({ kind: "event", event: "ev", timestamp: Date.now() });
    expect(calls).toBe(1);
    bridge.dispose();
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

  test("call(): a synchronously throwing adapter.post() rejects and cleans up (no leaked abort listener)", async () => {
    const adapter = createMockAdapter();
    adapter.post = (() => {
      throw new Error("sync post failure");
    }) as typeof adapter.post;
    const bridge = createBridge({ adapter, timeoutMs: 0 });
    const ctrl = new AbortController();
    const addSpy = vi.spyOn(ctrl.signal, "addEventListener");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");

    await expect(bridge.call("x", undefined, { signal: ctrl.signal })).rejects.toThrow(
      "sync post failure",
    );
    expect(removeSpy).toHaveBeenCalledTimes(addSpy.mock.calls.length);
    bridge.dispose();
  });

  test("call(): default timeout does not leak a timer when adapter.post() throws synchronously", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.post = (() => {
      throw new Error("sync post failure");
    }) as typeof adapter.post;
    const bridge = createBridge({ adapter });

    await expect(bridge.call("x")).rejects.toThrow("sync post failure");
    expect(vi.getTimerCount()).toBe(0);
    bridge.dispose();
  });

  test("call(): adapter.post() returning a non-promise does not synchronously throw a TypeError", async () => {
    let sent: unknown;
    const adapter = createMockAdapter();
    adapter.post = ((message: unknown) => {
      sent = message;
      return undefined as unknown as Promise<void>;
    }) as typeof adapter.post;
    const bridge = createBridge({ adapter, timeoutMs: 0 });

    let err: unknown = "not-settled";
    const ctrl = new AbortController();
    const pending = bridge.call("x", undefined, { signal: ctrl.signal }).catch((e: unknown) => {
      err = e;
    });
    // Let readiness settle and the attempt(post) microtask chain run, without
    // settling via a real response.
    await new Promise((r) => setTimeout(r, 0));
    expect((sent as { kind?: string } | undefined)?.kind).toBe("request");
    // The call is still pending (post() "succeeded", just sent nothing back),
    // not synchronously rejected with a TypeError from calling `.catch` on
    // a non-promise.
    expect(err).toBe("not-settled");
    ctrl.abort(new Error("cleanup"));
    await pending;
    bridge.dispose();
  });

  test("emit() slow path: a synchronously throwing adapter.post() rejects and detaches the abort listener", async () => {
    const adapter = createMockAdapter();
    adapter.post = (() => {
      throw new Error("sync post failure");
    }) as typeof adapter.post;
    const bridge = createBridge({ adapter });
    const ctrl = new AbortController();
    const addSpy = vi.spyOn(ctrl.signal, "addEventListener");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");

    await expect(bridge.emit("e", undefined, { signal: ctrl.signal })).rejects.toThrow(
      "sync post failure",
    );
    expect(removeSpy).toHaveBeenCalledTimes(addSpy.mock.calls.length);
    bridge.dispose();
  });

  test("event dispatch: an `event` getter that throws on a later read does not escape the dispatch loop", () => {
    // `event` is validated twice before the bridge's own event-case runs
    // (once by the mock adapter's dispatch, once by the bridge's inbound
    // subscriber). Return a valid value for those two reads and only throw
    // on a further read, so this exercises the bridge's own guard around
    // `envelope.event` rather than just isValidEnvelope's.
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spy = vi.fn();
    bridge.on("e", spy);

    let reads = 0;
    const envelope = {
      kind: "event",
      timestamp: Date.now(),
      get event(): string {
        reads++;
        if (reads <= 2) return "e";
        throw new Error("getter boom");
      },
    };

    expect(() => adapter.receive(envelope as never)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("event dispatch: reads `payload` once, so every listener in the fan-out sees the same value", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const seen: unknown[] = [];
    bridge.on("e", (p) => seen.push(p));
    bridge.on("e", (p) => seen.push(p));
    bridge.on("e", (p) => seen.push(p));

    let reads = 0;
    const envelope = {
      kind: "event",
      event: "e",
      timestamp: Date.now(),
      get payload(): number {
        reads++;
        return reads;
      },
    };

    adapter.receive(envelope as never);
    expect(seen).toEqual([1, 1, 1]);
    expect(reads).toBe(1);
    bridge.dispose();
  });
});

// ---------------------------------------------------------------------------
// 0.6.0 contract (2026-09-29 ai*js pass).
// ---------------------------------------------------------------------------

type Outcome = { value: unknown; done: Promise<void> };
function observe(p: Promise<unknown>): Outcome {
  const out: Outcome = { value: null, done: Promise.resolve() };
  out.done = p.then(
    () => {
      out.value = "resolved";
    },
    (err: unknown) => {
      out.value = err;
    },
  );
  return out;
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const evt = (event: string, payload?: unknown) =>
  ({ kind: "event", event, payload, timestamp: Date.now() }) as const;

// adapter.ready() that never resolves on its own but honours its signal the
// way the Flutter adapter does: it adds one abort listener per round and
// detaches it on abort. `live()` counts listeners still attached.
function hungReadyAdapter(): {
  adapter: ReturnType<typeof createMockAdapter>;
  signals: AbortSignal[];
  live: () => number;
} {
  const adapter = createMockAdapter();
  const signals: AbortSignal[] = [];
  let attached = 0;
  adapter.ready = (signal?: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      if (!signal) return;
      signals.push(signal);
      attached++;
      signal.addEventListener(
        "abort",
        () => {
          attached--;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  return { adapter, signals, live: () => attached };
}

describe("0.6.0: call() deadline covers the readiness wait (P1)", () => {
  test("a hung adapter.ready() with the default timeout rejects with BridgeTimeoutError at 10 s", async () => {
    vi.useFakeTimers();
    const { adapter } = hungReadyAdapter();
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });
    const out = observe(bridge.call("m"));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(out.value).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(out.value).toBeInstanceOf(BridgeTimeoutError);
    expect((out.value as Error).message).toBe("Call timeout: m");
    expect(postSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    bridge.dispose();
  });

  test("a per-call timeoutMs bounds the readiness phase", async () => {
    vi.useFakeTimers();
    const { adapter } = hungReadyAdapter();
    const bridge = createBridge({ adapter, timeoutMs: 0 });
    const out = observe(bridge.call("m", undefined, { timeoutMs: 250 }));
    await vi.advanceTimersByTimeAsync(249);
    expect(out.value).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(out.value).toBeInstanceOf(BridgeTimeoutError);
    bridge.dispose();
  });

  test("the deadline is measured from call() entry, not from readiness", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    adapter.ready = () => new Promise<void>((r) => setTimeout(r, 600));
    const bridge = createBridge({ adapter, timeoutMs: 1000 });
    const out = observe(bridge.call("m"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.value).toBeInstanceOf(BridgeTimeoutError);
    bridge.dispose();
  });

  test("timeoutMs: 0 arms no timer: it waits until reset() or dispose()", async () => {
    vi.useFakeTimers();
    const { adapter } = hungReadyAdapter();
    const bridge = createBridge({ adapter });
    const first = observe(bridge.call("a", undefined, { timeoutMs: 0 }));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(first.value).toBeNull();
    bridge.reset();
    await first.done;
    expect(first.value).toBeInstanceOf(BridgeResetError);

    const second = observe(bridge.call("b", undefined, { timeoutMs: 0 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(second.value).toBeNull();
    bridge.dispose();
    await second.done;
    expect(second.value).toBeInstanceOf(BridgeDisposedError);
  });

  test("a response arriving before the deadline clears the timer", async () => {
    vi.useFakeTimers();
    const adapter = createMockAdapter();
    autoReply(adapter);
    const bridge = createBridge({ adapter, timeoutMs: 1000 });
    await expect(bridge.call("m")).resolves.toEqual({ echo: "m" });
    expect(vi.getTimerCount()).toBe(0);
    bridge.dispose();
  });

  test("a caller abort during readiness wins over the deadline and leaves nothing armed", async () => {
    vi.useFakeTimers();
    const { adapter } = hungReadyAdapter();
    const bridge = createBridge({ adapter });
    const ctrl = new AbortController();
    const addSpy = vi.spyOn(ctrl.signal, "addEventListener");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const out = observe(bridge.call("m", undefined, { signal: ctrl.signal }));
    const reason = new Error("stop");
    ctrl.abort(reason);
    await out.done;
    expect(out.value).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeSpy).toHaveBeenCalledTimes(addSpy.mock.calls.length);
    bridge.dispose();
  });

  test("reset() during readiness wins over an armed deadline and clears it", async () => {
    vi.useFakeTimers();
    const { adapter } = hungReadyAdapter();
    const bridge = createBridge({ adapter });
    const out = observe(bridge.call("m"));
    bridge.reset();
    await out.done;
    expect(out.value).toBeInstanceOf(BridgeResetError);
    expect(vi.getTimerCount()).toBe(0);
    bridge.dispose();
  });

  test("pre-ready call()/emit() post in FIFO order whatever options each one passes", async () => {
    const adapter = createMockAdapter();
    const order: string[] = [];
    adapter.subscribe((envelope) => {
      if (envelope.kind === "request") {
        order.push(`req:${envelope.method}`);
        adapter.receive({ kind: "response", id: envelope.id, ok: true, timestamp: Date.now() });
      } else if (envelope.kind === "event") {
        order.push(`evt:${envelope.event}`);
      }
    });
    const bridge = createBridge({ adapter });
    const ctrl = new AbortController();
    await Promise.all([
      bridge.call("c1", undefined, { signal: ctrl.signal }),
      bridge.emit("e1"),
      bridge.call("c2", undefined, { timeoutMs: 0 }),
      bridge.emit("e2", undefined, { timeoutMs: 500 }),
      bridge.call("c3"),
    ]);
    expect(order).toEqual(["req:c1", "evt:e1", "req:c2", "evt:e2", "req:c3"]);
    bridge.dispose();
  });
});

describe("0.6.0: reset() keeps on() listeners (P2)", () => {
  test("listeners registered before reset() receive events dispatched after it", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spy = vi.fn();
    const onceSpy = vi.fn();
    const off = bridge.on("e", spy);
    bridge.on("e", onceSpy, { once: true });
    bridge.reset();

    adapter.receive(evt("e", 1));
    expect(spy).toHaveBeenCalledWith(1);
    expect(onceSpy).toHaveBeenCalledTimes(1);
    adapter.receive(evt("e", 2));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(onceSpy).toHaveBeenCalledTimes(1);

    off();
    adapter.receive(evt("e", 3));
    expect(spy).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  test("a signal-bound listener survives reset() and its signal still removes it", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const ctrl = new AbortController();
    const spy = vi.fn();
    bridge.on("e", spy, { signal: ctrl.signal });
    bridge.reset();
    adapter.receive(evt("e"));
    expect(spy).toHaveBeenCalledTimes(1);
    ctrl.abort();
    adapter.receive(evt("e"));
    expect(spy).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  test("dispose() still removes every listener", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spy = vi.fn();
    bridge.on("e", spy);
    bridge.reset();
    bridge.dispose();
    adapter.receive(evt("e"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("0.6.0: emit() is reclaimable by reset()/dispose() (P3)", () => {
  function hungPostAdapter(): {
    adapter: ReturnType<typeof createMockAdapter>;
    posted: () => number;
    finishPost: () => void;
  } {
    const adapter = createMockAdapter();
    const resolvers: (() => void)[] = [];
    adapter.post = () =>
      new Promise<void>((r) => {
        resolvers.push(r);
      });
    return {
      adapter,
      posted: () => resolvers.length,
      finishPost: () => {
        for (const r of resolvers) r();
      },
    };
  }

  test("an option-less emit() on a hung post() rejects with BridgeResetError on reset()", async () => {
    const { adapter, posted, finishPost } = hungPostAdapter();
    const bridge = createBridge({ adapter });
    const out = observe(bridge.emit("e"));
    await flush();
    expect(posted()).toBe(1);
    bridge.reset();
    await flush();
    expect(out.value).toBeInstanceOf(BridgeResetError);
    // A late post() settlement after reset() is ignored.
    finishPost();
    await flush();
    expect(out.value).toBeInstanceOf(BridgeResetError);
    bridge.dispose();
  });

  test("an option-less emit() on a hung post() rejects with BridgeDisposedError on dispose()", async () => {
    const { adapter, posted } = hungPostAdapter();
    const bridge = createBridge({ adapter });
    const out = observe(bridge.emit("e"));
    await flush();
    expect(posted()).toBe(1);
    bridge.dispose();
    await flush();
    expect(out.value).toBeInstanceOf(BridgeDisposedError);
  });

  test("an emit() still waiting for readiness is rejected by reset() and never posts", async () => {
    const { adapter } = hungReadyAdapter();
    const postSpy = vi.spyOn(adapter, "post");
    const bridge = createBridge({ adapter });
    const out = observe(bridge.emit("e"));
    bridge.reset();
    await out.done;
    expect(out.value).toBeInstanceOf(BridgeResetError);
    await flush();
    expect(postSpy).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("a settled emit() leaves nothing behind for reset()/dispose() to touch", async () => {
    vi.useFakeTimers();
    const { adapter, finishPost } = hungPostAdapter();
    const bridge = createBridge({ adapter });
    const signals = [new AbortController(), new AbortController(), new AbortController()];
    const spies = signals.map((c) => ({
      add: vi.spyOn(c.signal, "addEventListener"),
      remove: vi.spyOn(c.signal, "removeEventListener"),
    }));
    const resolved = observe(bridge.emit("ok", undefined, { signal: signals[0]!.signal }));
    await vi.advanceTimersByTimeAsync(0);
    finishPost();
    const aborted = observe(bridge.emit("abort", undefined, { signal: signals[1]!.signal }));
    const timedOut = observe(
      bridge.emit("late", undefined, { signal: signals[2]!.signal, timeoutMs: 100 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    signals[1]!.abort(new Error("stop"));
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved.value).toBe("resolved");
    expect((aborted.value as Error).message).toBe("stop");
    expect(timedOut.value).toBeInstanceOf(BridgeTimeoutError);
    expect(vi.getTimerCount()).toBe(0);

    const removeCounts = spies.map((s) => s.remove.mock.calls.length);
    bridge.reset();
    bridge.dispose();
    await vi.advanceTimersByTimeAsync(0);
    spies.forEach((s, i) => {
      expect(s.remove.mock.calls.length).toBe(removeCounts[i]);
      expect(s.remove.mock.calls.length).toBe(s.add.mock.calls.length);
    });
    expect(resolved.value).toBe("resolved");
  });
});

describe("0.6.0: each readiness round gets its own AbortSignal (P3)", () => {
  test("reset() during a hung ready() aborts the adapter-observed signal with BridgeResetError", async () => {
    const { adapter, signals } = hungReadyAdapter();
    const bridge = createBridge({ adapter });
    const first = observe(bridge.ready());
    expect(signals).toHaveLength(1);
    bridge.reset();
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[0]!.reason).toBeInstanceOf(BridgeResetError);
    await first.done;
    expect(first.value).toBeInstanceOf(BridgeResetError);

    void bridge.ready().catch(() => {});
    expect(signals).toHaveLength(2);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1]!.aborted).toBe(false);
    bridge.dispose();
  });

  test("dispose() aborts the live round with BridgeDisposedError", async () => {
    const { adapter, signals } = hungReadyAdapter();
    const bridge = createBridge({ adapter });
    const out = observe(bridge.ready());
    bridge.dispose();
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[0]!.reason).toBeInstanceOf(BridgeDisposedError);
    await out.done;
    expect(out.value).toBeInstanceOf(BridgeDisposedError);
  });

  test("repeated reset() against a hung ready() leaves no orphaned adapter listeners", () => {
    const { adapter, live } = hungReadyAdapter();
    const bridge = createBridge({ adapter });
    for (let i = 0; i < 5; i++) {
      void bridge.ready().catch(() => {});
      expect(live()).toBe(1);
      bridge.reset();
      expect(live()).toBe(0);
    }
    bridge.dispose();
  });

  test("a settled round's signal is not aborted by a later reset()", async () => {
    const adapter = createMockAdapter();
    const signals: AbortSignal[] = [];
    adapter.ready = async (signal?: AbortSignal) => {
      if (signal) signals.push(signal);
    };
    const bridge = createBridge({ adapter });
    await bridge.ready();
    bridge.reset();
    expect(signals[0]!.aborted).toBe(false);
    bridge.dispose();
  });

  test("a call() issued from the adapter's abort handler during reset() runs on a fresh round", async () => {
    const adapter = createMockAdapter();
    autoReply(adapter);
    const bridge = createBridge({ adapter });
    let rounds = 0;
    let reentrant: Promise<unknown> | undefined;
    adapter.ready = (signal?: AbortSignal) => {
      rounds++;
      if (rounds > 1) return Promise.resolve();
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reentrant = bridge.call("again");
          reject(signal.reason);
        });
      });
    };
    const first = observe(bridge.call("first"));
    bridge.reset();
    await first.done;
    expect(first.value).toBeInstanceOf(BridgeResetError);
    await expect(reentrant).resolves.toEqual({ echo: "again" });
    expect(rounds).toBe(2);
    bridge.dispose();
  });

  test("a rejected adapter.ready() is cached until reset() starts a new round", async () => {
    const adapter = createMockAdapter();
    autoReply(adapter);
    let rounds = 0;
    adapter.ready = async () => {
      rounds++;
      if (rounds === 1) throw new Error("not ready");
    };
    const bridge = createBridge({ adapter });
    await expect(bridge.call("a")).rejects.toThrow("not ready");
    await expect(bridge.emit("e")).rejects.toThrow("not ready");
    expect(rounds).toBe(1);
    bridge.reset();
    await expect(bridge.call("b")).resolves.toEqual({ echo: "b" });
    expect(rounds).toBe(2);
    bridge.dispose();
  });

  test("adapter.ready() returning a non-promise is treated as ready", async () => {
    const adapter = createMockAdapter();
    autoReply(adapter);
    adapter.ready = (() => undefined) as unknown as typeof adapter.ready;
    const bridge = createBridge({ adapter });
    await expect(bridge.call("m")).resolves.toEqual({ echo: "m" });
    bridge.dispose();
  });

  test("adapter.ready() throwing synchronously rejects readiness and detaches the round", async () => {
    const adapter = createMockAdapter();
    const signals: AbortSignal[] = [];
    adapter.ready = ((signal: AbortSignal) => {
      signals.push(signal);
      throw new Error("ready exploded");
    }) as typeof adapter.ready;
    const bridge = createBridge({ adapter });
    const removeSpy = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    await expect(bridge.ready()).rejects.toThrow("ready exploded");
    expect(removeSpy.mock.contexts).toContain(signals[0]);
    bridge.dispose();
    expect(signals[0]!.aborted).toBe(false);
  });
});

describe("0.6.0: inbound event fan-out re-entrancy", () => {
  test("a nested inbound dispatch runs depth-first before the outer fan-out resumes", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const order: string[] = [];
    bridge.on("outer", () => {
      order.push("outer:a");
      adapter.receive(evt("inner"));
      order.push("outer:a:end");
    });
    bridge.on("outer", () => order.push("outer:b"));
    bridge.on("inner", () => order.push("inner"));
    adapter.receive(evt("outer"));
    expect(order).toEqual(["outer:a", "inner", "outer:a:end", "outer:b"]);
    bridge.dispose();
  });

  test("a once listener is inert before its first call, so a nested re-dispatch cannot re-enter it", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    let calls = 0;
    bridge.on(
      "e",
      () => {
        calls++;
        adapter.receive(evt("e"));
      },
      { once: true },
    );
    adapter.receive(evt("e"));
    expect(calls).toBe(1);
    bridge.dispose();
  });

  test("the outer fan-out skips a sibling removed by a nested dispatch", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    const spyB = vi.fn();
    const off = { b: (): void => {} };
    bridge.on("outer", () => adapter.receive(evt("inner")));
    off.b = bridge.on("outer", spyB);
    bridge.on("inner", () => off.b());
    adapter.receive(evt("outer"));
    expect(spyB).not.toHaveBeenCalled();
    bridge.dispose();
  });
});

describe("0.6.0: argument validation", () => {
  test("createBridge() rejects a missing or non-object options argument with BridgeError", () => {
    for (const bad of [undefined, null, 42, "x"]) {
      expect(() => createBridge(bad as never)).toThrow(BridgeError);
      expect(() => createBridge(bad as never)).toThrow(/^aibridgejs: options must be an object$/);
    }
  });

  test("createBridge() rejects an adapter missing any required method", () => {
    const message =
      /^aibridgejs: adapter must be an object with ready, post, subscribe and dispose functions$/;
    expect(() => createBridge({} as never)).toThrow(message);
    for (const key of ["ready", "post", "subscribe", "dispose"] as const) {
      const adapter = { ...createMockAdapter(), [key]: undefined };
      expect(() => createBridge({ adapter } as never)).toThrow(BridgeError);
      expect(() => createBridge({ adapter } as never)).toThrow(message);
    }
  });

  test("on() rejects a non-function listener with BridgeError before registering it", () => {
    const adapter = createMockAdapter();
    const bridge = createBridge({ adapter });
    expect(() => bridge.on("e", 42 as never)).toThrow(BridgeError);
    expect(() => bridge.on("e", undefined as never)).toThrow(
      /^aibridgejs: listener must be a function$/,
    );
    const spy = vi.fn();
    bridge.on("e", spy);
    adapter.receive(evt("e"));
    expect(spy).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});
