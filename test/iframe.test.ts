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

  test("BRG-S-03: trailing-slash targetOrigin throws at construction", () => {
    // "https://example.com/" passes the old wildcard/empty check but never
    // equals an inbound event.origin (browsers normalise origins without a
    // trailing slash), so every call would silently time out (fail closed with
    // zero diagnostic). Reject it at construction instead.
    const host = createHost();
    expect(() => createIframeAdapter(host, { targetOrigin: "https://example.com/" })).toThrow(
      /origin/i,
    );
  });

  test("BRG-S-03: targetOrigin with a path throws at construction", () => {
    const host = createHost();
    expect(() => createIframeAdapter(host, { targetOrigin: "https://example.com/app" })).toThrow(
      /origin/i,
    );
  });

  test('BRG-S-03: literal "null" targetOrigin throws at construction', () => {
    // "null" would otherwise match every sandboxed/opaque-origin sender,
    // turning the exact-origin allowlist into an any-opaque-origin allowlist
    // (fail open).
    const host = createHost();
    expect(() => createIframeAdapter(host, { targetOrigin: "null" })).toThrow(/origin/i);
  });

  test("BRG-S-03: an exact origin (no trailing slash, no path) is accepted", () => {
    const host = createHost();
    expect(() => createIframeAdapter(host, { targetOrigin: "https://example.com" })).not.toThrow();
  });

  test("BRG-S-03: an exact origin with explicit port is accepted", () => {
    const host = createHost();
    expect(() =>
      createIframeAdapter(host, { targetOrigin: "https://example.com:8443" }),
    ).not.toThrow();
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

  test("expectedSource: null → origin-only acceptance (source check disabled)", () => {
    // Item 2(a): explicit expectedSource: null disables the event.source check;
    // any source value is accepted as long as origin matches.
    const host = createHost();
    const adapter = createIframeAdapter(host, {
      targetOrigin: "https://shell.example.com",
      expectedSource: null,
    });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    // Different source objects — all should pass because source check is off.
    adapter.dispatchTestMessage(
      { kind: "event", event: "a", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: { id: "any-source" } },
    );
    adapter.dispatchTestMessage(
      { kind: "event", event: "b", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: null },
    );
    adapter.dispatchTestMessage(
      { kind: "event", event: "c", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: undefined },
    );

    expect(seen).toHaveLength(3);
    expect(seen[0]?.kind).toBe("event");
  });

  test("no inferable postTarget → expectedSource defaults to null → origin-only fallback", () => {
    // Item 2(b): when postTarget cannot be inferred (plain host with no parent
    // and no postMessage), expectedSource defaults to null (origin-only
    // validation). This is the security-relevant default-derivation branch.
    const host = createHost(); // no .parent, no .postMessage
    const adapter = createIframeAdapter(host, {
      targetOrigin: "https://shell.example.com",
      // No postTarget provided; host has no parent → inferPostTarget returns null
      // → expectedSource falls back to null → source check disabled.
    });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    // Any source passes because expectedSource resolved to null.
    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: { id: "random-source" } },
    );
    adapter.dispatchTestMessage(
      { kind: "event", event: "test2", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: null },
    );

    expect(seen).toHaveLength(2);
  });

  test("matching origin but mismatched event.source in default parent-inferred config → rejected", () => {
    // Item 2(c): when postTarget is inferred from host.parent, expectedSource
    // is set to that parent object. A message from the correct origin but a
    // different source reference must be rejected.
    const postSpy = vi.fn();
    const parent = { postMessage: postSpy };
    const host = createHost() as IframeHost & {
      parent?: typeof parent;
    };
    host.parent = parent;

    const adapter = createIframeAdapter(host, {
      targetOrigin: "https://shell.example.com",
      // No explicit postTarget — inferPostTarget will pick host.parent,
      // so expectedSource === parent.
    });
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    // Message from the correct origin but a DIFFERENT source object.
    const wrongSource = { postMessage: vi.fn() };
    adapter.dispatchTestMessage(
      { kind: "event", event: "test", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: wrongSource },
    );

    // Must be rejected (source mismatch).
    expect(seen).toHaveLength(0);

    // Sanity: message with the correct source is accepted.
    adapter.dispatchTestMessage(
      { kind: "event", event: "test2", timestamp: Date.now() },
      { origin: "https://shell.example.com", source: parent },
    );
    expect(seen).toHaveLength(1);
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
