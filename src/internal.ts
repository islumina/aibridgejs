import type { BridgeEnvelope } from "./types.js";

export function isValidEnvelope(value: unknown): value is BridgeEnvelope {
  if (value === null || typeof value !== "object") return false;
  const v = value as {
    kind?: unknown;
    id?: unknown;
    method?: unknown;
    event?: unknown;
    ok?: unknown;
    timestamp?: unknown;
  };
  if (typeof v.timestamp !== "number") return false;

  switch (v.kind) {
    case "request":
      return typeof v.id === "string" && typeof v.method === "string";
    case "response":
      return typeof v.id === "string" && typeof v.ok === "boolean";
    case "event":
      return typeof v.event === "string";
    default:
      return false;
  }
}

type CryptoLike = { randomUUID?: () => string };

export function generateId(): string {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  // RFC 4122 v4 fallback for environments without crypto.randomUUID
  // (e.g. older Android WebViews on file:// origins). Not cryptographically
  // strong — uniqueness within a single bridge instance is sufficient.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function now(): number {
  return Date.now();
}
