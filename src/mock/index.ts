import { BridgeDisposedError } from "../errors.js";
import { isValidEnvelope } from "../internal.js";
import type { BridgeAdapter, BridgeEnvelope, SubscribeMeta } from "../types.js";

export interface MockAdapter extends BridgeAdapter {
  readonly platform: "mock";
  receive(envelope: BridgeEnvelope): void;
}

type Subscriber = (message: BridgeEnvelope, meta?: SubscribeMeta) => void;

/**
 * Create a mock bridge adapter.
 *
 * Pure-web safety: `dev only` — in-memory loopback; not for production traffic.
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 */
export function createMockAdapter(): MockAdapter {
  const subscribers = new Set<Subscriber>();
  const subCleanups = new Set<() => void>();
  let disposed = false;

  const dispatch = (envelope: BridgeEnvelope): void => {
    if (!isValidEnvelope(envelope)) return;
    for (const sub of Array.from(subscribers)) {
      sub(envelope);
    }
  };

  return {
    platform: "mock",

    async ready(): Promise<void> {
      if (disposed) throw new BridgeDisposedError();
    },

    async post(message: BridgeEnvelope): Promise<void> {
      if (disposed) throw new BridgeDisposedError();
      dispatch(message);
    },

    subscribe(listener, options) {
      if (disposed) return () => {};
      subscribers.add(listener);

      const signal = options?.signal;
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

    receive(envelope: BridgeEnvelope): void {
      if (disposed) return;
      dispatch(envelope);
    },

    dispose(): void {
      disposed = true;
      for (const off of Array.from(subCleanups)) off();
      subscribers.clear();
    },
  };
}
