// Envelope id / timestamp helpers. Only the bridge core (src/bridge.ts) uses
// them; they live outside internal.ts so the chunk shared with the adapter
// subpaths does not carry them.

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
