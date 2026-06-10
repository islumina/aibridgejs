import { BridgeDisposedError, BridgeError } from "../errors.js";
import { isValidEnvelope } from "../internal.js";
import type { BridgeAdapter, BridgeEnvelope, SubscribeMeta } from "../types.js";

export interface IframePostTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface IframeHost {
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

export interface MessageEventLike {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

export interface IframeAdapterOptions {
  targetOrigin: string;
  postTarget?: IframePostTarget;
  expectedSource?: unknown;
}

export interface IframeAdapter extends BridgeAdapter {
  readonly platform: "iframe";
  /** @internal Test-only helper. Not part of the public contract. */
  dispatchTestMessage(envelope: unknown, meta: { origin: string; source?: unknown }): void;
}

type Subscriber = (message: BridgeEnvelope, meta?: SubscribeMeta) => void;

function inferPostTarget(host: IframeHost): IframePostTarget | null {
  const parentCandidate = (host as { parent?: unknown }).parent;
  if (
    parentCandidate &&
    parentCandidate !== host &&
    typeof (parentCandidate as { postMessage?: unknown }).postMessage === "function"
  ) {
    return parentCandidate as IframePostTarget;
  }
  const self = host as unknown as { postMessage?: unknown };
  if (typeof self.postMessage === "function") {
    return host as unknown as IframePostTarget;
  }
  return null;
}

/**
 * Create an iframe bridge adapter.
 *
 * Pure-web safety: `pure-web safe` — pure postMessage API; requires exact targetOrigin (wildcard rejected).
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 *
 * **Security baseline — origin allowlisting:**
 * Every inbound message is checked against `targetOrigin`; messages from any
 * other origin are silently discarded. Exact-origin allowlisting is the
 * primary security gate and cannot be disabled.
 *
 * **`event.source` check — defense-in-depth:**
 * When `expectedSource` is a non-null value the adapter additionally verifies
 * that `event.source` matches exactly, providing a second layer of protection
 * against same-origin pages that share the targetOrigin. This check is
 * defense-in-depth: it can be disabled by passing `expectedSource: null`, in
 * which case only the origin is validated.
 *
 * **Default `expectedSource` derivation:**
 * - If `options.postTarget` is provided, `expectedSource` defaults to that
 *   same object (the target you post to is the source you trust).
 * - If no `postTarget` is given, the adapter tries to infer one from
 *   `host.parent` or `host` itself. If inference succeeds the inferred target
 *   becomes the default `expectedSource`.
 * - If inference fails (no parent, no `postMessage` on host), `expectedSource`
 *   defaults to `null` — origin-only validation applies. Callers in this
 *   configuration accept messages from any `event.source` as long as the
 *   origin matches. This is the safe fallback; pass an explicit
 *   `expectedSource` to re-enable the source check.
 */
export function createIframeAdapter(
  host: IframeHost,
  options: IframeAdapterOptions,
): IframeAdapter {
  if (!options.targetOrigin || options.targetOrigin === "*") {
    throw new Error("iframe adapter requires an exact targetOrigin (wildcard '*' is forbidden)");
  }

  // Validate that targetOrigin is already a bare origin. A trailing slash, a
  // path, or any other normalisation difference passes the wildcard/empty
  // check above but breaks the inbound gate: outbound postMessage succeeds
  // (the browser normalises the URL) while inbound `event.origin !==
  // targetOrigin` never matches, so every call silently times out (fail
  // closed, zero diagnostic). The opaque-origin literal "null" is rejected
  // too — it would match every sandboxed / opaque-origin sender, widening the
  // exact-origin allowlist into an any-opaque-origin allowlist (fail open).
  // (BRG-S-03)
  let normalisedOrigin: string;
  try {
    normalisedOrigin = new URL(options.targetOrigin).origin;
  } catch {
    throw new BridgeError(
      `iframe adapter requires a valid absolute origin for targetOrigin (got ${JSON.stringify(options.targetOrigin)})`,
    );
  }
  if (normalisedOrigin === "null" || options.targetOrigin !== normalisedOrigin) {
    throw new BridgeError(
      `iframe adapter requires an exact origin for targetOrigin (got ${JSON.stringify(options.targetOrigin)}, expected ${JSON.stringify(normalisedOrigin)})`,
    );
  }

  const targetOrigin = options.targetOrigin;
  const postTarget: IframePostTarget | null = options.postTarget ?? inferPostTarget(host);
  const expectedSource =
    "expectedSource" in options ? options.expectedSource : (postTarget ?? null);

  const subscribers = new Set<Subscriber>();
  const subCleanups = new Set<() => void>();
  let disposed = false;

  const messageHandler = (event: MessageEventLike): void => {
    if (disposed) return;
    if (event.origin !== targetOrigin) return;
    if (expectedSource != null && event.source !== expectedSource) return;
    if (!isValidEnvelope(event.data)) return;
    for (const sub of Array.from(subscribers)) {
      sub(event.data, { origin: event.origin, source: event.source });
    }
  };

  host.addEventListener("message", messageHandler);

  return {
    platform: "iframe",

    async ready(): Promise<void> {
      if (disposed) throw new BridgeDisposedError();
    },

    async post(message: BridgeEnvelope): Promise<void> {
      if (disposed) throw new BridgeDisposedError();
      if (!postTarget) {
        throw new Error("iframe adapter has no postMessage target");
      }
      postTarget.postMessage(message, targetOrigin);
    },

    subscribe(listener, opts) {
      if (disposed) return () => {};
      subscribers.add(listener);

      const signal = opts?.signal;
      const unsubscribe = (): void => {
        subscribers.delete(listener);
        subCleanups.delete(unsubscribe);
        signal?.removeEventListener("abort", unsubscribe);
      };
      subCleanups.add(unsubscribe);

      if (signal) {
        if (signal.aborted) {
          unsubscribe();
        } else {
          signal.addEventListener("abort", unsubscribe, { once: true });
        }
      }

      return unsubscribe;
    },

    /** @internal Test-only helper. Not part of the public contract. */
    dispatchTestMessage(envelope, meta) {
      messageHandler({
        data: envelope,
        origin: meta.origin,
        source: "source" in meta ? meta.source : expectedSource,
      });
    },

    dispose(): void {
      disposed = true;
      host.removeEventListener("message", messageHandler);
      for (const off of Array.from(subCleanups)) off();
      subscribers.clear();
    },
  };
}
