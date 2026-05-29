import { describe, expect, test, vi } from "vitest";
import {
  type IframeHost,
  type MessageEventLike,
  createIframeAdapter,
} from "../src/iframe/index.js";
import type { BridgeEnvelope } from "../src/types.js";

function createHost(): IframeHost & {
  fire: (event: MessageEventLike) => void;
} {
  const listeners = new Set<(event: MessageEventLike) => void>();
  return {
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    fire(event) {
      for (const l of listeners) l(event);
    },
  };
}

describe("aibridgejs iframe adapter", () => {
  test("A14: wildcard targetOrigin '*' throws at construction", () => {
    const host = createHost();
    expect(() => createIframeAdapter(host, { targetOrigin: "*" })).toThrow(/wildcard/);
  });

  test("empty targetOrigin throws at construction", () => {
    const host = createHost();
    expect(() => createIframeAdapter(host, { targetOrigin: "" })).toThrow();
  });

  test("gate 6: wrong-origin inbound is discarded", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://evil.example.com" },
    );

    expect(seen).toHaveLength(0);
  });

  test("matching-origin inbound is dispatched", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com" },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("event");
  });

  test("A15: source mismatch is discarded when expectedSource is set", () => {
    const host = createHost();
    const trustedSource = { id: "trusted" };
    const adapter = createIframeAdapter(host, {
      targetOrigin: "https://shell.example.com",
      expectedSource: trustedSource,
    });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: { id: "untrusted" } },
    );

    expect(seen).toHaveLength(0);
  });

  test("expectedSource: undefined skips source check (sentinel parity)", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, {
      targetOrigin: "https://shell.example.com",
      expectedSource: undefined,
    });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: { id: "anything" } },
    );
    adapter.dispatchTestMessage(
      { kind: "event", event: "test2", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: null },
    );

    expect(seen).toHaveLength(2);
  });

  test("A16: malformed inbound is discarded", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.dispatchTestMessage({ not: "valid" }, { origin: "https://shell.example.com" });
    adapter.dispatchTestMessage(null, { origin: "https://shell.example.com" });
    adapter.dispatchTestMessage("string", { origin: "https://shell.example.com" });

    expect(seen).toHaveLength(0);
  });

  test("messageHandler is attached to host on construction", () => {
    const host = createHost();
    const spy = vi.spyOn(host, "addEventListener");
    createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    expect(spy).toHaveBeenCalledWith("message", expect.any(Function));
  });

  test("dispose detaches abort listeners from externally-held signals", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    adapter.subscribe(() => {}, { signal: controller.signal });
    adapter.dispose();
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("dispose removes message listener and clears subscribers", () => {
    const host = createHost();
    const removeSpy = vi.spyOn(host, "removeEventListener");
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    adapter.dispose();
    expect(removeSpy).toHaveBeenCalled();
  });

  test("post uses explicit postTarget when provided", async () => {
    const host = createHost();
    const postSpy = vi.fn();
    const adapter = createIframeAdapter(host, {
      targetOrigin: "https://shell.example.com",
      postTarget: { postMessage: postSpy },
    });

    await adapter.post({ kind: "event", event: "ping", timestamp: Date.now() });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]?.[1]).toBe("https://shell.example.com");
  });

  test("post throws when no postTarget can be inferred", async () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });

    await expect(
      adapter.post({ kind: "event", event: "ping", timestamp: Date.now() }),
    ).rejects.toThrow(/postMessage target/);
  });

  test("post falls back to host itself when host has postMessage but no parent", async () => {
    const postSpy = vi.fn();
    const host = createHost() as IframeHost & { postMessage?: typeof postSpy };
    host.postMessage = postSpy;

    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    await adapter.post({ kind: "event", event: "ping", timestamp: Date.now() });

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test("post falls back to host.parent when present", async () => {
    const postSpy = vi.fn();
    const host = createHost() as IframeHost & {
      parent?: { postMessage: typeof postSpy };
      fire: (e: MessageEventLike) => void;
    };
    host.parent = { postMessage: postSpy };

    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    await adapter.post({ kind: "event", event: "ping", timestamp: Date.now() });

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test("subscribe unsubscribe stops dispatch", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const seen: BridgeEnvelope[] = [];
    const off = adapter.subscribe((envelope) => seen.push(envelope));

    off();
    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com" },
    );

    expect(seen).toHaveLength(0);
  });

  test("subscribe with non-aborted signal removes listener on later abort", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const seen: BridgeEnvelope[] = [];
    const controller = new AbortController();

    adapter.subscribe((e) => seen.push(e), { signal: controller.signal });
    adapter.dispatchTestMessage(
      { kind: "event", event: "first", timestamp: Date.now() },
      { origin: "https://shell.example.com" },
    );

    controller.abort();
    adapter.dispatchTestMessage(
      { kind: "event", event: "second", timestamp: Date.now() },
      { origin: "https://shell.example.com" },
    );

    expect(seen).toHaveLength(1);
  });

  test("subscribe with already-aborted signal does not register", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const seen: BridgeEnvelope[] = [];
    const controller = new AbortController();
    controller.abort();

    adapter.subscribe((e) => seen.push(e), { signal: controller.signal });
    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com" },
    );

    expect(seen).toHaveLength(0);
  });

  test("ready after dispose throws", async () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    adapter.dispose();
    await expect(adapter.ready()).rejects.toThrow();
  });

  test("subscribe after dispose returns inert unsubscribe", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    adapter.dispose();
    const off = adapter.subscribe(() => {});
    expect(() => off()).not.toThrow();
  });

  test("messages received after dispose are ignored", () => {
    const host = createHost();
    const adapter = createIframeAdapter(host, { targetOrigin: "https://shell.example.com" });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((e) => seen.push(e));
    adapter.dispose();
    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com" },
    );
    expect(seen).toHaveLength(0);
  });
});
