import { BridgeDisposedError } from "../errors.js";
import { isValidEnvelope } from "../internal.js";
import type { BridgeAdapter, BridgeEnvelope, SubscribeMeta } from "../types.js";

export interface FlutterInAppWebView {
  callHandler(name: string, ...args: unknown[]): Promise<unknown>;
}

export interface FlutterHost {
  flutter_inappwebview?: FlutterInAppWebView;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FlutterAdapterOptions {
  handlerName?: string;
  waitForReadyEvent?: boolean;
  readyEventName?: string;
}

export interface FlutterAdapter extends BridgeAdapter {
  readonly platform: "flutter";
  receive(envelope: BridgeEnvelope): void;
}

type Subscriber = (message: BridgeEnvelope, meta?: SubscribeMeta) => void;

const DEFAULT_HANDLER_NAME = "aibridgejs";
const DEFAULT_READY_EVENT = "flutterInAppWebViewPlatformReady";

/**
 * Create a Flutter bridge adapter.
 *
 * Pure-web safety: `requires native shell` — needs `host.flutter_inappwebview.callHandler`.
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 */
export function createFlutterAdapter(
  host: FlutterHost,
  options: FlutterAdapterOptions = {},
): FlutterAdapter {
  const handlerName = options.handlerName ?? DEFAULT_HANDLER_NAME;
  const waitForReady = options.waitForReadyEvent ?? true;
  const readyEventName = options.readyEventName ?? DEFAULT_READY_EVENT;

  const subscribers = new Set<Subscriber>();
  let disposed = false;

  let resolveReady: (() => void) | undefined;
  let rejectReady: ((err: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const onReadyEvent = (): void => {
    if (resolveReady) {
      const r = resolveReady;
      resolveReady = undefined;
      rejectReady = undefined;
      r();
    }
  };

  if (waitForReady) {
    host.addEventListener(readyEventName, onReadyEvent, { once: true });
  } else {
    onReadyEvent();
  }

  const dispatch = (envelope: unknown): void => {
    if (disposed) return;
    if (!isValidEnvelope(envelope)) return;
    for (const sub of Array.from(subscribers)) {
      sub(envelope);
    }
  };

  return {
    platform: "flutter",

    ready(signal?: AbortSignal): Promise<void> {
      if (disposed) return Promise.reject(new BridgeDisposedError());
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (!signal) return readyPromise;

      return new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          signal.removeEventListener("abort", onAbort);
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        readyPromise.then(
          () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
          (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        );
      });
    },

    async post(message: BridgeEnvelope): Promise<void> {
      if (disposed) throw new BridgeDisposedError();
      const handler = host.flutter_inappwebview;
      if (!handler?.callHandler) {
        throw new Error("flutter_inappwebview.callHandler is not available");
      }

      const result = await handler.callHandler(handlerName, message);

      // For 'request' envelopes Dart returns a 'response' envelope which we
      // route back through subscribers so the bridge's pending map resolves.
      // For 'event' envelopes Dart returns null and we skip dispatch.
      if (result !== null && result !== undefined) {
        dispatch(result);
      }
    },

    subscribe(listener, opts) {
      if (disposed) return () => {};
      subscribers.add(listener);

      const unsubscribe = (): void => {
        subscribers.delete(listener);
      };

      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) {
          unsubscribe();
        } else {
          signal.addEventListener("abort", unsubscribe, { once: true });
        }
      }

      return unsubscribe;
    },

    receive(envelope: BridgeEnvelope): void {
      dispatch(envelope);
    },

    dispose(): void {
      disposed = true;
      host.removeEventListener(readyEventName, onReadyEvent);
      if (rejectReady) {
        const r = rejectReady;
        resolveReady = undefined;
        rejectReady = undefined;
        r(new BridgeDisposedError());
      }
      subscribers.clear();
    },
  };
}
