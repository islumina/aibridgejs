import {
  BridgeDisposedError,
  BridgeRemoteError,
  BridgeResetError,
  BridgeTimeoutError,
} from "./errors.js";
import { generateId, isValidEnvelope, now } from "./internal.js";
import type {
  Bridge,
  BridgeEnvelope,
  BridgeListener,
  BridgeOptions,
  BridgePlatform,
  CallOptions,
  OnOptions,
  ReadyOptions,
} from "./types.js";

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
}

interface ListenerEntry {
  fn: BridgeListener<unknown>;
  unsubscribe: () => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createBridge(options: BridgeOptions): Bridge {
  const adapter = options.adapter;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const pending = new Map<string, PendingEntry>();
  const events = new Map<string, Set<ListenerEntry>>();
  const internalController = new AbortController();
  let disposed = false;
  let readyPromise: Promise<void> | null = null;
  let resetEpoch = 0;

  const unsubscribeAdapter = adapter.subscribe((envelope) => {
    if (disposed) return;
    if (!isValidEnvelope(envelope)) return;

    switch (envelope.kind) {
      case "response": {
        const entry = pending.get(envelope.id);
        if (!entry) return;
        pending.delete(envelope.id);
        entry.cleanup();
        if (envelope.ok) {
          entry.resolve(envelope.payload);
        } else {
          const err = envelope.error;
          entry.reject(
            new BridgeRemoteError(
              err?.message ?? "Remote error",
              err?.code ?? "REMOTE_ERROR",
              err?.detail,
            ),
          );
        }
        return;
      }
      case "event": {
        const set = events.get(envelope.event);
        if (!set) return;
        for (const listenerEntry of Array.from(set)) {
          try {
            listenerEntry.fn(envelope.payload);
          } catch {
            // Swallow listener errors so one bad listener can't poison the rest
          }
        }
        return;
      }
      case "request": {
        // v0.1: inbound requests are not dispatched. Explicit no-op for clarity.
        return;
      }
    }
  });

  function throwIfDisposed(): void {
    if (disposed) throw new BridgeDisposedError();
  }

  function ready(opts?: ReadyOptions): Promise<void> {
    throwIfDisposed();
    const userSignal = opts?.signal;

    if (userSignal?.aborted) {
      return Promise.reject(userSignal.reason);
    }

    if (!readyPromise) {
      // The bridge wraps adapter.ready so that dispose() rejects the cached
      // promise even when an adapter ignores its signal argument.
      readyPromise = new Promise<void>((resolve, reject) => {
        const onDisposed = (): void => {
          internalController.signal.removeEventListener("abort", onDisposed);
          reject(new BridgeDisposedError());
        };
        internalController.signal.addEventListener("abort", onDisposed, { once: true });

        adapter.ready(internalController.signal).then(
          () => {
            internalController.signal.removeEventListener("abort", onDisposed);
            if (disposed) reject(new BridgeDisposedError());
            else resolve();
          },
          (err) => {
            internalController.signal.removeEventListener("abort", onDisposed);
            reject(err);
          },
        );
      });
    }

    if (!userSignal) {
      return readyPromise;
    }

    return new Promise<void>((resolve, reject) => {
      const onUserAbort = (): void => {
        userSignal.removeEventListener("abort", onUserAbort);
        reject(userSignal.reason);
      };
      userSignal.addEventListener("abort", onUserAbort, { once: true });

      readyPromise!.then(
        () => {
          userSignal.removeEventListener("abort", onUserAbort);
          resolve();
        },
        (err) => {
          userSignal.removeEventListener("abort", onUserAbort);
          reject(err);
        },
      );
    });
  }

  async function call(method: string, payload?: unknown, opts?: CallOptions): Promise<unknown> {
    throwIfDisposed();
    const signal = opts?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }

    const capturedEpoch = resetEpoch;
    await (signal !== undefined ? ready({ signal }) : ready());

    if (disposed) throw new BridgeDisposedError();
    if (resetEpoch !== capturedEpoch) throw new BridgeResetError();
    if (signal?.aborted) throw signal.reason;

    const id = generateId();
    const callTimeoutMs = opts?.timeoutMs ?? defaultTimeoutMs;

    return new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortHandler: (() => void) | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
          abortHandler = undefined;
        }
      };

      pending.set(id, { resolve, reject, cleanup });

      if (callTimeoutMs > 0) {
        timer = setTimeout(() => {
          const current = pending.get(id);
          if (!current) return;
          pending.delete(id);
          current.cleanup();
          reject(new BridgeTimeoutError(`Call timeout: ${method}`));
        }, callTimeoutMs);
      }

      if (signal) {
        abortHandler = (): void => {
          const current = pending.get(id);
          if (!current) return;
          pending.delete(id);
          current.cleanup();
          reject(signal.reason);
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      const envelope: BridgeEnvelope = {
        kind: "request",
        id,
        method,
        payload,
        timestamp: now(),
      };

      adapter.post(envelope).catch((err: unknown) => {
        const current = pending.get(id);
        if (!current) return;
        pending.delete(id);
        current.cleanup();
        reject(err);
      });
    });
  }

  async function emit(event: string, payload?: unknown): Promise<void> {
    throwIfDisposed();
    const capturedEpoch = resetEpoch;
    await ready();
    if (disposed) throw new BridgeDisposedError();
    if (resetEpoch !== capturedEpoch) throw new BridgeResetError();

    const envelope: BridgeEnvelope = {
      kind: "event",
      event,
      payload,
      timestamp: now(),
    };

    await adapter.post(envelope);
  }

  function on<T = unknown>(
    event: string,
    listener: BridgeListener<T>,
    opts?: OnOptions,
  ): () => void {
    throwIfDisposed();

    let set = events.get(event);
    if (!set) {
      set = new Set();
      events.set(event, set);
    }

    const signal = opts?.signal;
    const once = opts?.once === true;

    let removed = false;
    // biome-ignore lint/style/useConst: hoisted so the unsubscribe closure can reference entry by identity
    let entry!: ListenerEntry;

    const unsubscribe = (): void => {
      if (removed) return;
      removed = true;
      const s = events.get(event);
      if (s) {
        s.delete(entry);
        if (s.size === 0) events.delete(event);
      }
      signal?.removeEventListener("abort", unsubscribe);
    };

    const wrapped: BridgeListener<unknown> = once
      ? (payload) => {
          unsubscribe();
          (listener as BridgeListener<unknown>)(payload);
        }
      : (listener as BridgeListener<unknown>);

    entry = { fn: wrapped, unsubscribe };
    set.add(entry);

    if (signal) {
      if (signal.aborted) {
        unsubscribe();
      } else {
        signal.addEventListener("abort", unsubscribe, { once: true });
      }
    }

    return unsubscribe;
  }

  function platform(): BridgePlatform {
    throwIfDisposed();
    return adapter.platform;
  }

  function rejectAllPending(err: Error): void {
    const entries = Array.from(pending.values());
    pending.clear();
    for (const entry of entries) {
      entry.cleanup();
      entry.reject(err);
    }
  }

  function unsubscribeAllListeners(): void {
    const allEntries: ListenerEntry[] = [];
    for (const set of events.values()) {
      for (const entry of set) allEntries.push(entry);
    }
    events.clear();
    for (const entry of allEntries) {
      entry.unsubscribe();
    }
  }

  function reset(): void {
    throwIfDisposed();
    resetEpoch++;
    rejectAllPending(new BridgeResetError());
    unsubscribeAllListeners();
    readyPromise = null;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    internalController.abort(new BridgeDisposedError());
    rejectAllPending(new BridgeDisposedError());
    unsubscribeAllListeners();
    unsubscribeAdapter();
    adapter.dispose();
  }

  return {
    ready,
    call,
    emit,
    on,
    platform,
    reset,
    dispose,
  };
}
