import {
  BridgeDisposedError,
  BridgeRemoteError,
  BridgeResetError,
  BridgeTimeoutError,
} from "./errors.js";
import { generateId, now } from "./id.js";
import { invalid, isObject, isValidEnvelope } from "./internal.js";
import type {
  Bridge,
  BridgeEnvelope,
  BridgeListener,
  BridgeOptions,
  BridgePlatform,
  CallOptions,
  EmitOptions,
  OnOptions,
  ReadyOptions,
  ResponseEnvelope,
} from "./types.js";

// Adapter methods are typed to return a Promise, but a type-valid custom
// adapter can still throw synchronously or return a non-thenable. Route every
// adapter.ready() / adapter.post() call through this wrapper so a sync throw
// becomes an ordinary rejection (every settle path registered around the call
// still runs) and a non-promise return resolves instead of making
// `.then`/`.catch` itself throw.
function attempt(fn: () => Promise<void>): Promise<void> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err);
  }
}

// One in-flight call() or emit(). Both methods are settle-once: the first of
// resolve/reject wins and runs the operation's whole teardown.
interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface ListenerEntry {
  fn: BridgeListener<unknown>;
  unsubscribe: () => void;
  // Set true the instant this entry's unsubscribe() runs (its own removal, a
  // sibling's unsubscribe, a signal abort, a `once` listener going inert
  // before its first call, or dispose()). The fan-out loop checks this on
  // every iteration so a listener removed mid-dispatch — including by a
  // nested dispatch — does not still run from the outer loop's snapshot.
  // reset() is not a removal path: only dispose() removes listeners in bulk.
  removed: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// setTimeout stores its delay as a signed 32-bit int: anything larger
// (including Infinity) overflows and fires after ~1 ms (Node clamps with a
// TimeoutOverflowWarning; browsers treat it as 0) — the opposite of a long
// deadline.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const ADAPTER_METHODS = ["ready", "post", "subscribe", "dispose"] as const;

// A missing or NaN timeout (e.g. `Number(badEnvValue)`) takes the fallback. NaN
// fails both `> 0` and `<= 0`, so it would otherwise silently disable the timer.
function timeoutOr(timeoutMs: number | undefined, fallback: number): number {
  return timeoutMs === undefined || Number.isNaN(timeoutMs) ? fallback : timeoutMs;
}

// The only source of setTimeout delays (ai*js family timer rule, optional
// deadlines): undefined means "no timer". Non-positive (<= 0, BRG-R-02) and
// Infinity disable it; finite values above the 32-bit limit are clamped to it
// rather than overflowing.
function clampDelay(timeoutMs: number): number | undefined {
  if (!(timeoutMs > 0) || timeoutMs === Number.POSITIVE_INFINITY) return undefined;
  return Math.min(timeoutMs, MAX_TIMER_DELAY_MS);
}

export function createBridge(options: BridgeOptions): Bridge {
  if (!isObject(options)) invalid("options", "an object");
  const adapter = options.adapter;
  if (!isObject(adapter) || ADAPTER_METHODS.some((key) => typeof adapter[key] !== "function")) {
    invalid("adapter", "an object with ready, post, subscribe and dispose functions");
  }
  const defaultTimeoutMs = timeoutOr(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  // Every in-flight call() and emit(), from entry to settle: reset() and
  // dispose() reject whatever is still here. `pending` indexes the calls that
  // have posted their request by id, for response correlation only.
  const inflight = new Set<PendingEntry>();
  const pending = new Map<string, PendingEntry>();
  const events = new Map<string, Set<ListenerEntry>>();
  let disposed = false;
  let readyPromise: Promise<void> | null = null;
  // The live readiness round. Its signal is the one adapter.ready() observes;
  // reset() aborts it with BridgeResetError and dispose() with
  // BridgeDisposedError, which also settles every bridge-side ready waiter
  // even when the adapter ignores the signal. Cleared once the round settles.
  let round: AbortController | null = null;

  const unsubscribeAdapter = adapter.subscribe((envelope) => {
    if (disposed) return;
    if (!isValidEnvelope(envelope)) return;

    switch (envelope.kind) {
      case "response": {
        // Read the id exactly once into a local: a value-varying getter must
        // not look up one entry and settle another.
        const id = envelope.id;
        const entry = pending.get(id);
        if (!entry) return;

        // Capture every field this branch needs (ok, and on success payload;
        // on failure the error object) BEFORE settling the entry. The envelope
        // crosses an untrusted boundary: any of these may be a throwing
        // getter, and a throw must become a deterministic reject of THIS call
        // rather than escape after its timer and abort listener are gone
        // (BRG-S-01). `payload` is only touched on the success path so an
        // error response's payload getter is never invoked.
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
          ok = false;
          payload = undefined;
          errorObject = undefined;
          readThrew = true;
        }

        if (!readThrew && ok) {
          entry.resolve(payload);
          return;
        }
        // Defensive coercion: a malformed host sending a non-string
        // code/message must not surface a non-string on BridgeRemoteError
        // (whose code/message are typed string). Each field is read exactly
        // once inside a guard, since `errorObject` may itself carry throwing
        // or value-varying getters; any failure keeps the safe defaults.
        let message = "Remote error";
        let code = "REMOTE_ERROR";
        let detail: unknown;
        try {
          const rawMessage: unknown = errorObject?.message;
          const rawCode: unknown = errorObject?.code;
          if (typeof rawMessage === "string") message = rawMessage;
          if (typeof rawCode === "string") code = rawCode;
          detail = errorObject?.detail;
        } catch {
          // Getter threw — keep the safe defaults already assigned above.
        }
        entry.reject(new BridgeRemoteError(message, code, detail));
        return;
      }
      case "event": {
        // Read `event` and `payload` exactly once, up front, inside a guard: a
        // value-varying or throwing getter on an in-process envelope must not
        // throw out of the adapter's dispatch loop or hand different listeners
        // different payload values (aibridgejs-11).
        let eventName: unknown;
        let eventPayload: unknown;
        try {
          eventName = envelope.event;
          eventPayload = envelope.payload;
        } catch {
          return;
        }
        if (typeof eventName !== "string") return;

        const set = events.get(eventName);
        if (!set) return;
        // Synchronous, depth-first fan-out over a snapshot (ai*js family
        // re-entrancy rule): a nested dispatch from inside a listener runs to
        // completion before this loop resumes; entries removed meanwhile are
        // skipped; dispose() stops the loop outright (BRG-R-05).
        // Listener throws are discarded by design (FAM-S-07): one misbehaving
        // listener must not starve its siblings or escape into the adapter's
        // inbound callback. There is no onError hook in the stable surface;
        // consumers wrap their own listener body in try/catch.
        for (const listenerEntry of Array.from(set)) {
          if (disposed) break;
          if (listenerEntry.removed) continue;
          try {
            listenerEntry.fn(eventPayload);
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
      const controller = new AbortController();
      const { signal } = controller;
      round = controller;
      readyPromise = new Promise<void>((resolve, reject) => {
        // Settles on the first of: adapter.ready() resolving or rejecting,
        // or this round's signal aborting (reset / dispose). Detaches the
        // abort listener on every path, and only clears `round` while it
        // still points at this round, so a late settle of a round that
        // reset() already replaced cannot clobber the new one.
        const settle = (fn: () => void): void => {
          signal.removeEventListener("abort", onAbort);
          if (round === controller) round = null;
          fn();
        };
        const onAbort = (): void => settle(() => reject(signal.reason));
        signal.addEventListener("abort", onAbort, { once: true });
        attempt(() => adapter.ready(signal)).then(
          () => settle(resolve),
          (err: unknown) => settle(() => reject(err)),
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

  // Shared by call() and emit(), entered synchronously from their entry. The
  // deadline is armed here, before readiness, so it bounds the readiness wait,
  // adapter.post() and (for call()) the response wait. The caller's signal,
  // the deadline, reset()/dispose() (via `inflight`) and the operation itself
  // all race to settle one entry; the first wins and every path runs the same
  // teardown. Both operations chain directly on the shared ready promise, so
  // pre-ready call()/emit() post in FIFO order whatever options they pass.
  function send<T>(
    signal: AbortSignal | undefined,
    delay: number | undefined,
    timeoutMessage: string,
    envelope: () => BridgeEnvelope,
    id?: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (fn: () => void): void => {
        if (!inflight.delete(entry)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (id !== undefined) pending.delete(id);
        fn();
      };
      const entry: PendingEntry = {
        resolve: (value) => settle(() => resolve(value as T)),
        reject: (reason) => settle(() => reject(reason)),
      };
      const onAbort = (): void => entry.reject(signal?.reason);

      inflight.add(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (delay !== undefined) {
        timer = setTimeout(() => entry.reject(new BridgeTimeoutError(timeoutMessage)), delay);
      }
      ready()
        .then(() => {
          if (!inflight.has(entry)) return;
          // SAFETY (call only): the resolved value is whatever the host sent.
          // `T` is a caller assertion; the runtime does not validate response
          // payloads — validate with a schema library at the boundary.
          if (id !== undefined) pending.set(id, entry);
          return attempt(() => adapter.post(envelope()));
        })
        .then(id === undefined ? entry.resolve : undefined, entry.reject);
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
    // A non-positive timeout (<= 0) or Infinity arms no timer (BRG-R-02): the
    // call then stays pending until a response, its signal, reset() or
    // dispose() settles it. Pass 0 only with your own AbortSignal deadline.
    const id = generateId();
    return send<T>(
      signal,
      clampDelay(timeoutOr(opts?.timeoutMs, defaultTimeoutMs)),
      `Call timeout: ${method}`,
      () => ({ kind: "request", id, method, payload, timestamp: now() }),
      id,
    );
  }

  async function emit(event: string, payload?: unknown, opts?: EmitOptions): Promise<void> {
    throwIfDisposed();
    const signal = opts?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }
    // Opt-in deadline: without timeoutMs an emit is unbounded in time but
    // still reclaimable — reset() and dispose() reject it.
    const timeoutMs = opts?.timeoutMs;
    return send<void>(
      signal,
      timeoutMs === undefined ? undefined : clampDelay(timeoutMs),
      `Emit timeout: ${event}`,
      () => ({ kind: "event", event, payload, timestamp: now() }),
    );
  }

  function on<T = unknown>(
    event: string,
    listener: BridgeListener<T>,
    opts?: OnOptions,
  ): () => void {
    throwIfDisposed();
    if (typeof listener !== "function") invalid("listener", "a function");

    let set = events.get(event);
    if (!set) {
      set = new Set();
      events.set(event, set);
    }

    const signal = opts?.signal;
    const once = opts?.once === true;

    // biome-ignore lint/style/useConst: hoisted so the unsubscribe closure can reference entry by identity
    let entry!: ListenerEntry;

    const unsubscribe = (): void => {
      if (entry.removed) return;
      entry.removed = true;
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

    entry = { fn: wrapped, unsubscribe, removed: false };
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

  function rejectInflight(err: Error): void {
    for (const entry of Array.from(inflight)) entry.reject(err);
  }

  // Forget cached readiness and abort the live round. `round` and
  // `readyPromise` are cleared BEFORE the abort, which runs adapter listeners
  // synchronously: a call()/emit() they issue starts a fresh round instead of
  // chaining on the aborted one.
  function endRound(reason: Error): void {
    const live = round;
    round = null;
    readyPromise = null;
    live?.abort(reason);
  }

  function reset(): void {
    throwIfDisposed();
    rejectInflight(new BridgeResetError());
    endRound(new BridgeResetError());
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    rejectInflight(new BridgeDisposedError());
    endRound(new BridgeDisposedError());
    const allEntries: ListenerEntry[] = [];
    for (const set of events.values()) allEntries.push(...set);
    events.clear();
    for (const entry of allEntries) entry.unsubscribe();
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
