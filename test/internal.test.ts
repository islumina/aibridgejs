import { afterEach, describe, expect, test, vi } from "vitest";
import { generateId, isValidEnvelope } from "../src/internal.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isValidEnvelope", () => {
  test("rejects non-objects", () => {
    expect(isValidEnvelope(null)).toBe(false);
    expect(isValidEnvelope(undefined)).toBe(false);
    expect(isValidEnvelope("string")).toBe(false);
    expect(isValidEnvelope(42)).toBe(false);
    expect(isValidEnvelope(true)).toBe(false);
  });

  test("rejects objects missing timestamp", () => {
    expect(isValidEnvelope({ kind: "event", event: "x" })).toBe(false);
  });

  test("rejects non-finite timestamps", () => {
    expect(isValidEnvelope({ kind: "event", event: "x", timestamp: Number.NaN })).toBe(false);
    expect(
      isValidEnvelope({ kind: "event", event: "x", timestamp: Number.POSITIVE_INFINITY }),
    ).toBe(false);
    expect(
      isValidEnvelope({ kind: "event", event: "x", timestamp: Number.NEGATIVE_INFINITY }),
    ).toBe(false);
  });

  test("rejects unknown kind with valid timestamp", () => {
    expect(isValidEnvelope({ kind: "weird", timestamp: 1 })).toBe(false);
    expect(isValidEnvelope({ kind: undefined, timestamp: 1 })).toBe(false);
    expect(isValidEnvelope({ timestamp: 1 })).toBe(false);
  });

  test("accepts valid request envelope", () => {
    expect(isValidEnvelope({ kind: "request", id: "x", method: "m", timestamp: 1 })).toBe(true);
  });

  test("rejects request envelope with non-string id", () => {
    expect(isValidEnvelope({ kind: "request", id: 42, method: "m", timestamp: 1 })).toBe(false);
  });

  test("rejects request envelope missing method", () => {
    expect(isValidEnvelope({ kind: "request", id: "x", timestamp: 1 })).toBe(false);
  });

  test("accepts valid response envelope", () => {
    expect(isValidEnvelope({ kind: "response", id: "x", ok: true, timestamp: 1 })).toBe(true);
  });

  test("rejects response envelope with non-boolean ok", () => {
    expect(isValidEnvelope({ kind: "response", id: "x", ok: "yes", timestamp: 1 })).toBe(false);
  });

  test("accepts valid event envelope", () => {
    expect(isValidEnvelope({ kind: "event", event: "x", timestamp: 1 })).toBe(true);
  });

  test("rejects event envelope with non-string event", () => {
    expect(isValidEnvelope({ kind: "event", event: 42, timestamp: 1 })).toBe(false);
  });

  // BRG-S-02: residual gaps — empty-string identity fields and array values.
  test("rejects request envelope with empty-string id", () => {
    expect(isValidEnvelope({ kind: "request", id: "", method: "m", timestamp: 1 })).toBe(false);
  });

  test("rejects request envelope with empty-string method", () => {
    expect(isValidEnvelope({ kind: "request", id: "x", method: "", timestamp: 1 })).toBe(false);
  });

  test("rejects response envelope with empty-string id", () => {
    // An empty-string id would otherwise probe pending.get("") — harmless today
    // (generateId never emits "") but a needless attack surface.
    expect(isValidEnvelope({ kind: "response", id: "", ok: true, timestamp: 1 })).toBe(false);
  });

  test("rejects event envelope with empty-string event name", () => {
    expect(isValidEnvelope({ kind: "event", event: "", timestamp: 1 })).toBe(false);
  });

  test("rejects arrays even with a bolted-on kind/timestamp", () => {
    // Arrays are typeof 'object' and not null, so the bare object guard let an
    // array carrying a `kind` property slip through. An array is never a valid
    // envelope; reject it early.
    const reqLike: unknown[] = [];
    Object.assign(reqLike, { kind: "request", id: "x", method: "m", timestamp: 1 });
    expect(isValidEnvelope(reqLike)).toBe(false);

    const evtLike: unknown[] = [];
    Object.assign(evtLike, { kind: "event", event: "e", timestamp: 1 });
    expect(isValidEnvelope(evtLike)).toBe(false);
  });
});

describe("generateId", () => {
  test("returns a UUID-like string by default", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("falls back to Math.random when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("falls back when crypto is completely absent", () => {
    vi.stubGlobal("crypto", undefined);
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("produces unique ids across many calls (fallback path)", () => {
    vi.stubGlobal("crypto", {});
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateId());
    expect(seen.size).toBe(100);
  });
});
