import type { BridgeEnvelope } from "./types.js";

export function isValidEnvelope(value: unknown): value is BridgeEnvelope {
  // Reject null, primitives, and arrays. Arrays are typeof 'object' and not
  // null, so without the Array.isArray guard an array carrying a bolted-on
  // `kind` property would slip past the object check (BRG-S-02).
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as {
    kind?: unknown;
    id?: unknown;
    method?: unknown;
    event?: unknown;
    ok?: unknown;
    timestamp?: unknown;
  };

  // Every field read below may be a getter, and an in-process caller (mock /
  // flutter `receive()`, a custom adapter) can hand the bridge an envelope
  // whose getters throw or return a different value on each access. The
  // whole check runs in one try/catch, and each field is read exactly once
  // into a local before being tested twice (typeof + length), so a throwing
  // or value-varying getter can neither escape as an uncaught exception into
  // the adapter's dispatch loop nor pass a different value to the length
  // check than the typeof check already validated (aibridgejs-11).
  try {
    const timestamp = v.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;

    // Identity fields (id / method / event) must be non-empty strings. An
    // empty string passes a bare typeof check but is never a meaningful
    // envelope id, method, or event name; rejecting it removes a needless
    // probe surface (e.g. a response with id:"" probing pending.get("")) —
    // BRG-S-02.
    switch (v.kind) {
      case "request": {
        const id = v.id;
        const method = v.method;
        return (
          typeof id === "string" && id.length > 0 && typeof method === "string" && method.length > 0
        );
      }
      case "response": {
        const id = v.id;
        const ok = v.ok;
        return typeof id === "string" && id.length > 0 && typeof ok === "boolean";
      }
      case "event": {
        const event = v.event;
        return typeof event === "string" && event.length > 0;
      }
      default:
        return false;
    }
  } catch {
    // A field getter threw during validation — treat the envelope as
    // invalid rather than let the exception propagate.
    return false;
  }
}

type CryptoLike = { randomUUID?: () => string };

/**
 * Generate a unique envelope ID. Prefers `crypto.randomUUID()` when available
 * (modern browsers, Node 19+, Bun, Deno, recent Android WebView).
 *
 * SECURITY: the fallback uses `Math.random()` for compatibility with older
 * Android WebViews on file:// origins where Web Crypto is unavailable. This
 * fallback is **not cryptographically strong** — IDs are unguessable enough
 * for in-process call/response correlation within a single bridge instance,
 * but should NOT be relied on as a security primitive across trust
 * boundaries. In particular:
 *
 *   - Do NOT share a single mock / flutter adapter instance across mutually
 *     untrusting code paths and expect ID unpredictability to prevent
 *     response replay or front-running. Adapters bound to specific hosts
 *     (iframe with strict targetOrigin / Flutter InAppWebView) get their
 *     authenticity from origin + source validation, not from ID secrecy.
 *   - If you need an unforgeable correlation token across a real trust
 *     boundary, layer your own signed nonce on top of `payload`.
 */
export function generateId(): string {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  // RFC 4122 v4 fallback. See JSDoc above for the security caveat.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function now(): number {
  return Date.now();
}
