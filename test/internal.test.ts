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
