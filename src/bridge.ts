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
  ResponseEnvelope,
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
  // Captured `reject` of the cached `readyPromise`, so that `reset()` can
  // settle ready waiters synchronously instead of leaving them parked
  // forever on a slow adapter.ready(). Cleared whenever readyPromise resolves,
  // rejects, or is invalidated by reset / dispose.
  let readyReject: ((reason: unknown) => void) | null = null;
  let resetEpoch = 0;

  const unsubscribeAdapter = adapter.subscribe((envelope) => {
    if (disposed) return;
    if (!isValidEnvelope(envelope)) return;

    switch (envelope.kind) {
      case "response": {
        // Read the id exactly once into a local and reuse it for both the
        // lookup and the delete. The pre-0.5.6 handler read `envelope.id`
        // twice (get + delete); a value-varying getter could delete the wrong
        // key, leaking the real pending entry and desynchronising settlement.
        const id = envelope.id;
        const entry = pending.get(id);
        if (!entry) return;

        // Capture every field this branch needs (ok, and on success payload;
        // on failure the error object) BEFORE mutating `pending` or calling
        // entry.cleanup(). The envelope crosses an untrusted boundary: any of
        // these may be a throwing getter. The 0.5.1 fix guarded only the
        // ok:false message/code reads — but on the ok:true success path
        // `envelope.ok` and `envelope.payload` were read AFTER cleanup() had
        // cleared the timeout and detached the abort listener, so a throw
        // there left the call promise hanging forever, past its own timeout
        // and beyond any AbortSignal. Reading first means any throw becomes a
        // deterministic reject of THIS call (BRG-S-01). `ok` and `payload` are
        // each read exactly once into locals; `payload` is only touched on the
        // success path so an error response's payload getter is never invoked.
        let ok: boolean;
        let payload: unknown;
        let errorObject: ResponseEnvelope["error"];
        let readThrew = false;
        try {
          ok = envelope.ok;
          if (ok) {
            payload = envelope.payload;
          } else {
            errorObject = envelope.error;
          }
        } catch {
          // A field getter threw. We cannot trust this response; settle the
          // call deterministically with a safe remote-error rather than hang.
          ok = false;
          payload = undefined;
          errorObject = undefined;
          readThrew = true;
        }

        pending.delete(id);
        entry.cleanup();

        if (!readThrew && ok) {
          entry.resolve(payload);
        } else {
          // Defensive coercion: ResponseEnvelope types code/message as strings,
          // but a malformed host sending a non-string code/message must not
          // surface a non-string on BridgeRemoteError (whose code/message are
          // typed string). Fall back to the defaults when a field is missing,
          // the wrong type, or unreadable (readThrew, where errorObject is the
          // safe `undefined`).
          //
          // The reads below are wrapped in try/catch for the same throwing-
          // getter reason: `errorObject.message` / `.code` / `.detail` may
          // themselves throw. The fallback values match the type-mismatch
          // fallbacks above.
          let message = "Remote error";
          let code = "REMOTE_ERROR";
          let detail: unknown;
          try {
            // Read each field exactly once: with hostile getters/proxies a
            // second access could re-run side effects or return a different
            // (non-string) value than the typeof check observed.
            const rawMessage: unknown = errorObject?.message;
            const rawCode: unknown = errorObject?.code;
            if (typeof rawMessage === "string") message = rawMessage;
            if (typeof rawCode === "string") code = rawCode;
            detail = errorObject?.detail;
          } catch {
            // Getter threw — keep the safe defaults already assigned above.
          }
          entry.reject(new BridgeRemoteError(message, code, detail));
        }
        return;
      }
      case "event": {
        const set = events.get(envelope.event);
        if (!set) return;
        // Listener-error swallow strategy (FAM-S-07): each subscriber is invoked
        // inside its own try/catch and any throw is intentionally discarded.
        // Rationale: event dispatch is a fan-out with no return channel, so one
        // misbehaving listener must not abort the loop and starve its siblings,
        // nor escape into the adapter's inbound-message callback (which has no
        // sensible recovery and, on some transports, would surface as an
        // unhandled error). The bridge deliberately does NOT expose these
        // errors: there is no onError hook in the 0.x stable surface. Consumers
        // that need visibility must wrap their own listener body in try/catch.
        // This also means a throwing `envelope.payload` getter degrades to "no
        // listener sees this event" rather than a crash or hang.
        for (const listenerEntry of Array.from(set)) {
          try {
            listenerEntry.fn(envelope.payload);
          } catch {
            // See the strategy note above — swallow by design.
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
      // The bridge wraps adapter.ready so that dispose() / reset() can settle
      // the cached promise even when an adapter ignores its signal argument.
      readyPromise = new Promise<void>((resolve, reject) => {
        // Hoisted so wrappedReject can remove this exact listener by identity.
        // biome-ignore lint/style/useConst: assigned below before any call site runs
        let onDisposed!: () => void;
        // Identity-guarded reject. After reset() invalidates this promise and
        // a new one takes its place, a late adapter.ready() resolve/reject
        // from THIS round must not clear the NEW round's readyReject. We
        // capture the local function and only clear the module-level slot if
        // it still points at our handle. It also detaches the dispose listener
        // on every settle path, so repeated reset() against a hung
        // adapter.ready() can't accumulate orphaned listeners on the signal.
        const wrappedReject = (reason: unknown): void => {
          internalController.signal.removeEventListener("abort", onDisposed);
          if (readyReject === wrappedReject) readyReject = null;
          reject(reason);
        };
        readyReject = wrappedReject;

        onDisposed = (): void => {
          wrappedReject(new BridgeDisposedError());
        };
        internalController.signal.addEventListener("abort", onDisposed, { once: true });

        adapter.ready(internalController.signal).then(
          () => {
            internalController.signal.removeEventListener("abort", onDisposed);
            if (readyReject === wrappedReject) readyReject = null;
            if (disposed) reject(new BridgeDisposedError());
            else resolve();
          },
          (err) => {
            wrappedReject(err);
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

  async function call<T = unknown>(
    method: string,
    payload?: unknown,
    opts?: CallOptions,
  ): Promise<T> {
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

    return new Promise<T>((resolve, reject) => {
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

      // SAFETY: the cast widens `(value: T) => void` to `(value: unknown) => void`
      // so the adapter dispatch path (which sees envelopes as `unknown`) can
      // call resolve without re-introducing generics into the PendingEntry
      // map. This is sound because the runtime does NOT validate response
      // payloads — `T` is a caller assertion; the resolved value is whatever
      // the host actually sent. Callers that need runtime narrowing should
      // validate with Zod / Valibot at the boundary (see README).
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        cleanup,
      });

      // A non-positive timeout (<= 0) DISABLES the per-call timer entirely
      // (BRG-R-02). The call then stays pending until it is settled by a
      // response, an AbortSignal, reset(), or dispose(). This is the documented
      // contract (see README "createBridge" / "call"): pass 0 only when you
      // supply your own AbortSignal-based deadline, otherwise a silent host
      // leaves the entry pinned. The default path (10 s) remains bounded.
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
    // Settle any call() / ready() waiters that are still parked on the
    // current readyPromise — otherwise a slow / hung adapter.ready() would
    // strand them indefinitely past reset.
    if (readyReject) {
      readyReject(new BridgeResetError());
      readyReject = null;
    }
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
