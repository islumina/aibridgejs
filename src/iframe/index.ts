import { BridgeDisposedError } from "../errors.js";
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

export function createIframeAdapter(
  host: IframeHost,
  options: IframeAdapterOptions,
): IframeAdapter {
  if (!options.targetOrigin || options.targetOrigin === "*") {
    throw new Error("iframe adapter requires an exact targetOrigin (wildcard '*' is forbidden)");
  }

  const targetOrigin = options.targetOrigin;
  const postTarget: IframePostTarget | null = options.postTarget ?? inferPostTarget(host);
  const expectedSource =
    "expectedSource" in options ? options.expectedSource : (postTarget ?? null);

  const subscribers = new Set<Subscriber>();
  let disposed = false;

  const messageHandler = (event: MessageEventLike): void => {
    if (disposed) return;
    if (event.origin !== targetOrigin) return;
    if (expectedSource !== null && event.source !== expectedSource) return;
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
      subscribers.clear();
    },
  };
}
