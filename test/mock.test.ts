import { describe, expect, test } from "vitest";
import { createMockAdapter } from "../src/mock/index.js";
import type { BridgeEnvelope } from "../src/types.js";

describe("aibridgejs mock adapter", () => {
  test("ready resolves immediately", async () => {
    const adapter = createMockAdapter();
    await expect(adapter.ready()).resolves.toBeUndefined();
  });

  test("post echoes to subscribers synchronously", async () => {
    const adapter = createMockAdapter();
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    await adapter.post({
      kind: "event",
      event: "ping",
      timestamp: Date.now(),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("event");
  });

  test("receive() injects synthetic inbound envelopes", () => {
    const adapter = createMockAdapter();
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.receive({
      kind: "response",
      id: "x",
      ok: true,
      timestamp: Date.now(),
    });

    expect(seen).toHaveLength(1);
  });

  test("receive() drops malformed envelopes", () => {
    const adapter = createMockAdapter();
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.receive({ not: "valid" } as never);
    adapter.receive(null as never);

    expect(seen).toHaveLength(0);
  });

  test("unsubscribe stops further notifications", async () => {
    const adapter = createMockAdapter();
    const seen: BridgeEnvelope[] = [];
    const off = adapter.subscribe((envelope) => seen.push(envelope));

    off();
    await adapter.post({ kind: "event", event: "ping", timestamp: Date.now() });

    expect(seen).toHaveLength(0);
  });

  test("subscribe with already-aborted signal does not register", async () => {
    const adapter = createMockAdapter();
    const seen: BridgeEnvelope[] = [];
    const controller = new AbortController();
    controller.abort();

    adapter.subscribe((envelope) => seen.push(envelope), { signal: controller.signal });
    await adapter.post({ kind: "event", event: "ping", timestamp: Date.now() });

    expect(seen).toHaveLength(0);
  });

  test("subscribe with signal removes listener on abort", async () => {
    const adapter = createMockAdapter();
    const seen: BridgeEnvelope[] = [];
    const controller = new AbortController();

    adapter.subscribe((envelope) => seen.push(envelope), { signal: controller.signal });
    await adapter.post({ kind: "event", event: "first", timestamp: Date.now() });

    controller.abort();
    await adapter.post({ kind: "event", event: "second", timestamp: Date.now() });

    expect(seen).toHaveLength(1);
  });

  test("dispose rejects subsequent post and receive becomes no-op", async () => {
    const adapter = createMockAdapter();
    const seen: BridgeEnvelope[] = [];
    adapter.subscribe((envelope) => seen.push(envelope));

    adapter.dispose();
    await expect(
      adapter.post({ kind: "event", event: "ping", timestamp: Date.now() }),
    ).rejects.toThrow();

    adapter.receive({ kind: "event", event: "ping", timestamp: Date.now() });
    expect(seen).toHaveLength(0);
  });

  test("ready after dispose rejects", async () => {
    const adapter = createMockAdapter();
    adapter.dispose();
    await expect(adapter.ready()).rejects.toThrow();
  });

  test("subscribe after dispose returns inert unsubscribe", () => {
    const adapter = createMockAdapter();
    adapter.dispose();
    const off = adapter.subscribe(() => {});
    expect(() => off()).not.toThrow();
  });

  test("platform is 'mock'", () => {
    const adapter = createMockAdapter();
    expect(adapter.platform).toBe("mock");
  });
});
