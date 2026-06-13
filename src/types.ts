export type BridgePlatform = "iframe" | "flutter" | "mock" | "unknown";

export type RequestEnvelope = {
  kind: "request";
  id: string;
  method: string;
  payload?: unknown;
  timestamp: number;
};

export type ResponseEnvelope = {
  kind: "response";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    detail?: unknown;
  };
  timestamp: number;
};

export type EventEnvelope = {
  kind: "event";
  event: string;
  payload?: unknown;
  timestamp: number;
};

export type BridgeEnvelope = RequestEnvelope | ResponseEnvelope | EventEnvelope;

export type BridgeListener<T = unknown> = (payload: T) => void;

export type SubscribeMeta = {
  origin?: string;
  source?: unknown;
};

export interface BridgeAdapter {
  readonly platform: BridgePlatform;
  ready(signal?: AbortSignal): Promise<void>;
  post(message: BridgeEnvelope): Promise<void>;
  subscribe(
    listener: (message: BridgeEnvelope, meta?: SubscribeMeta) => void,
    options?: { signal?: AbortSignal },
  ): () => void;
  dispose(): void;
}

export interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface EmitOptions {
  /**
   * Per-call deadline for the readiness wait + adapter `post()`, in ms.
   *
   * Unlike {@link CallOptions.timeoutMs}, this is opt-in only: when omitted
   * `emit()` arms NO timer and keeps the pre-existing fire-and-forget contract
   * (it waits for readiness and `post()` with no time bound). A positive value
   * rejects with `BridgeTimeoutError` once elapsed; a non-positive value
   * (`<= 0`) explicitly disables the timer — pair it with `signal` if the
   * adapter may hang.
   */
  timeoutMs?: number;
  /**
   * Abort a single in-flight `emit()` (its readiness wait or `post()`) without
   * resetting / disposing the whole bridge. Rejects with the signal's reason.
   */
  signal?: AbortSignal;
}

export interface OnOptions {
  signal?: AbortSignal;
  once?: boolean;
}

export interface ReadyOptions {
  signal?: AbortSignal;
}

export interface Bridge {
  ready(options?: ReadyOptions): Promise<void>;
  call<T = unknown>(method: string, payload?: unknown, options?: CallOptions): Promise<T>;
  emit(event: string, payload?: unknown, options?: EmitOptions): Promise<void>;
  on<T = unknown>(event: string, listener: BridgeListener<T>, options?: OnOptions): () => void;
  platform(): BridgePlatform;
  reset(): void;
  dispose(): void;
}

export interface BridgeOptions {
  adapter: BridgeAdapter;
  timeoutMs?: number;
}
