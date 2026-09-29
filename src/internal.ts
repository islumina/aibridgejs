import { BridgeError } from "./errors.js";
import type { BridgeEnvelope } from "./types.js";

export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

// Argument misuse is reported as `aibridgejs: <subject> must be <constraint>`
// through BridgeError (ai*js family error rule), never as a bare TypeError from
// a property read on a missing argument.
export function invalid(subject: string, constraint: string): never {
  throw new BridgeError(`aibridgejs: ${subject} must be ${constraint}`);
}

// iframe / Flutter adapters register and detach host listeners, so the host
// must expose both methods before any side effect.
export function assertHost(host: unknown): void {
  const h = host as { addEventListener?: unknown; removeEventListener?: unknown } | null;
  if (
    !isObject(h) ||
    typeof h.addEventListener !== "function" ||
    typeof h.removeEventListener !== "function"
  ) {
    invalid("host", "an object with addEventListener and removeEventListener functions");
  }
}

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
