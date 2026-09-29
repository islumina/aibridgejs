import { describe, expect, test, vi } from "vitest";
import { detectBridgeAdapter } from "../src/detect/index.js";
import { BridgeError } from "../src/errors.js";
import {
  type FlutterHost,
  type FlutterInAppWebView,
  createFlutterAdapter,
} from "../src/flutter/index.js";
import { createBridge } from "../src/index.js";
import type { BridgeEnvelope } from "../src/types.js";

function createHost(flutter?: FlutterInAppWebView): FlutterHost & { fire: (name: string) => void } {
  const listeners = new Map<string, Set<() => void>>();
  const host: FlutterHost & { fire: (name: string) => void } = {
    addEventListener(type, listener, opts) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const wrapped = opts?.once
        ? () => {
            set!.delete(wrapped);
            listener();
          }
        : listener;
      // store original for removeEventListener equality
      (wrapped as unknown as { original: () => void }).original = listener;
      set.add(wrapped);
    },
    removeEventListener(type, listener) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of set) {
        if (fn === listener || (fn as unknown as { original?: () => void }).original === listener) {
          set.delete(fn);
        }
      }
    },
    fire(name) {
      const set = listeners.get(name);
      if (!set) return;
      for (const fn of Array.from(set)) fn();
    },
  };
  if (flutter) host.flutter_inappwebview = flutter;
  return host;
}

describe("aibridgejs flutter adapter", () => {
  test("ready waits for platform-ready event when waitForReadyEvent is true", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: true });

    let resolved = false;
    const promise = adapter.ready().then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);

    host.fire("flutterInAppWebViewPlatformReady");
    await promise;
    expect(resolved).toBe(true);
  });

  test("A13: ready event fires before ready() is awaited — still resolves", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: true });

    host.fire("flutterInAppWebViewPlatformReady");
    await expect(adapter.ready()).resolves.toBeUndefined();
  });

  test("ready resolves immediately when waitForReadyEvent is false", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
    await expect(adapter.ready()).resolves.toBeUndefined();
  });

  test("ready respects AbortSignal", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: true });
    const controller = new AbortController();
    const promise = adapter.ready(controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(promise).rejects.toThrow("cancelled");
  });

  test("ready with signal resolves when ready event fires before abort", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: true });
    const controller = new AbortController();
    const promise = adapter.ready(controller.signal);
    host.fire("flutterInAppWebViewPlatformReady");
    await expect(promise).resolves.toBeUndefined();
  });

  test("dispose rejects in-flight ready with BridgeDisposedError", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: true });
    const controller = new AbortController();
    const promise = adapter.ready(controller.signal);
    adapter.dispose();
    await expect(promise).rejects.toThrow(/disposed/i);
  });

  test("dispose before any ready() call does not surface an unhandled rejection (eager readyPromise)", async () => {
    // Regression for BRG-R-01: the adapter's readyPromise is created eagerly at
    // construction. With waitForReadyEvent defaulting to true, no `.then` is
    // attached until someone calls ready(). The documented teardown
    // createFlutterAdapter(...) → dispose() WITHOUT a prior ready() rejected a
    // promise that had zero handlers → unhandledRejection (fatal under Node
    // --unhandled-rejections=strict; a suite failure under vitest). The fix
    // attaches a no-op rejection handler (or lazily creates the promise) so the
    // disposed-without-ready path stays silent.
    const captured: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      captured.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const host = createHost({ callHandler: vi.fn() });
      const adapter = createFlutterAdapter(host, { waitForReadyEvent: true });
      // Dispose immediately — no ready()/call()/emit() ever attached a handler
      // to the eager readyPromise.
      adapter.dispose();
      // Let the rejection-tracking microtask/macrotask settle so any
      // unhandledRejection would have fired.
      await new Promise((r) => setTimeout(r, 10));
      expect(captured).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("ready with already-aborted signal rejects synchronously", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: true });
    const controller = new AbortController();
    controller.abort(new Error("pre"));
    await expect(adapter.ready(controller.signal)).rejects.toThrow("pre");
  });

  test("post calls callHandler with the configured handler name", async () => {
    const callHandler = vi.fn().mockResolvedValue(null);
    const host = createHost({ callHandler });
    const adapter = createFlutterAdapter(host, {
      handlerName: "myBridge",
      waitForReadyEvent: false,
    });

    const envelope: BridgeEnvelope = {
      kind: "event",
      event: "ping",
      timestamp: Date.now(),
    };
    await adapter.post(envelope);

    expect(callHandler).toHaveBeenCalledWith("myBridge", envelope);
  });

  test("post routes a response envelope from callHandler back through subscribers", async () => {
    const responseEnvelope: BridgeEnvelope = {
      kind: "response",
      id: "abc",
      ok: true,
      payload: { result: 42 },
      timestamp: Date.now(),
    };
    const callHandler = vi.fn().mockResolvedValue(responseEnvelope);
    const host = createHost({ callHandler });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });

    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    await adapter.post({
      kind: "request",
      id: "abc",
      method: "doStuff",
      timestamp: Date.now(),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(responseEnvelope);
  });

  test("A12: callHandler returning null does not synthesize an inbound", async () => {
    const callHandler = vi.fn().mockResolvedValue(null);
    const host = createHost({ callHandler });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });

    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    await adapter.post({ kind: "event", event: "ping", timestamp: Date.now() });

    expect(seen).toHaveLength(0);
  });

  test("A11: callHandler rejection propagates as post rejection", async () => {
    const callHandler = vi.fn().mockRejectedValue(new Error("native failure"));
    const host = createHost({ callHandler });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });

    await expect(
      adapter.post({ kind: "event", event: "ping", timestamp: Date.now() }),
    ).rejects.toThrow("native failure");
  });

  test("post throws when callHandler is not available", async () => {
    const host = createHost();
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });

    await expect(
      adapter.post({ kind: "event", event: "ping", timestamp: Date.now() }),
    ).rejects.toThrow(/callHandler is not available/);
  });

  test("receive() injects synthetic inbound envelopes", () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });

    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.receive({ kind: "event", event: "pushed", timestamp: Date.now() });
    expect(seen).toHaveLength(1);
  });

  test("receive() drops malformed envelopes", () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });

    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.receive({ not: "valid" } as never);
    expect(seen).toHaveLength(0);
  });

  test("dispose detaches abort listeners from externally-held signals", () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    adapter.subscribe(() => {}, { signal: controller.signal });
    adapter.dispose();
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("post, receive, and ready reject after dispose", async () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
    adapter.dispose();

    await expect(adapter.ready()).rejects.toThrow();
    await expect(
      adapter.post({ kind: "event", event: "ping", timestamp: Date.now() }),
    ).rejects.toThrow();

    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((e) => seen.push(e));
    adapter.receive({ kind: "event", event: "ping", timestamp: Date.now() });
    expect(seen).toHaveLength(0);
  });

  test("subscribe with already-aborted signal does not register", () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
    const seen: BridgeEnvelope[] = [];
    const controller = new AbortController();
    controller.abort();

    adapter.subscribe((e) => seen.push(e), { signal: controller.signal });
    adapter.receive({ kind: "event", event: "ping", timestamp: Date.now() });

    expect(seen).toHaveLength(0);
  });

  test("subscribe signal abort removes listener", () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
    const seen: BridgeEnvelope[] = [];
    const controller = new AbortController();

    adapter.subscribe((e) => seen.push(e), { signal: controller.signal });
    adapter.receive({ kind: "event", event: "first", timestamp: Date.now() });

    controller.abort();
    adapter.receive({ kind: "event", event: "second", timestamp: Date.now() });

    expect(seen).toHaveLength(1);
  });

  test("subscribe after dispose returns inert unsubscribe", () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
    adapter.dispose();
    expect(() => adapter.subscribe(() => {})()).not.toThrow();
  });

  test("a host without addEventListener/removeEventListener throws BridgeError before any side effect", () => {
    const message =
      /^aibridgejs: host must be an object with addEventListener and removeEventListener functions$/;
    for (const bad of [undefined, null, {}, { addEventListener: vi.fn() }]) {
      expect(() => createFlutterAdapter(bad as never)).toThrow(BridgeError);
      expect(() => createFlutterAdapter(bad as never)).toThrow(message);
    }
  });

  test("a non-object options argument throws BridgeError, not a TypeError", () => {
    const host = createHost({ callHandler: vi.fn() });
    const addSpy = vi.spyOn(host, "addEventListener");
    expect(() => createFlutterAdapter(host, null as never)).toThrow(BridgeError);
    expect(() => createFlutterAdapter(host, 42 as never)).toThrow(
      /^aibridgejs: options must be an object$/,
    );
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("platform is 'flutter'", () => {
    const host = createHost({ callHandler: vi.fn() });
    const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
    expect(adapter.platform).toBe("flutter");
  });

  // flutter_inappwebview's Android / Windows PLATFORM_READY_JS_SOURCE dispatches
  // the one-shot event AND sets `window.flutter_inappwebview._platformReady =
  // true`. Model that host so an adapter created after the event can be tested.
  function fireAndroidPlatformReady(host: FlutterHost & { fire: (name: string) => void }): void {
    host.fire("flutterInAppWebViewPlatformReady");
    (
      host.flutter_inappwebview as FlutterInAppWebView & { _platformReady?: boolean }
    )._platformReady = true;
  }

  test("adapter created AFTER the platform-ready event feature-checks _platformReady and is ready", async () => {
    const host = createHost({ callHandler: vi.fn() });
    fireAndroidPlatformReady(host);

    const adapter = createFlutterAdapter(host);
    let resolved = false;
    const promise = adapter.ready().then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(true);
    await promise;
    adapter.dispose();
  });

  test("bridge over a lazily detected flutter adapter round-trips call() after the event (and after reset())", async () => {
    const host = createHost({
      callHandler: async (_name: string, env: unknown) => ({
        kind: "response",
        id: (env as { id: string }).id,
        ok: true,
        payload: "pong",
        timestamp: Date.now(),
      }),
    });
    fireAndroidPlatformReady(host);

    const adapter = detectBridgeAdapter(host);
    expect(adapter.platform).toBe("flutter");
    const bridge = createBridge({ adapter, timeoutMs: 100 });
    await expect(bridge.call("ping")).resolves.toBe("pong");
    bridge.reset();
    await expect(bridge.call("ping")).resolves.toBe("pong");
    bridge.dispose();
  });
});
