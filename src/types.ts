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

export interface OnOptions {
  signal?: AbortSignal;
  once?: boolean;
}

export interface ReadyOptions {
  signal?: AbortSignal;
}

export interface Bridge {
  ready(options?: ReadyOptions): Promise<void>;
  call(method: string, payload?: unknown, options?: CallOptions): Promise<unknown>;
  emit(event: string, payload?: unknown): Promise<void>;
  on<T = unknown>(event: string, listener: BridgeListener<T>, options?: OnOptions): () => void;
  platform(): BridgePlatform;
  reset(): void;
  dispose(): void;
}

export interface BridgeOptions {
  adapter: BridgeAdapter;
  timeoutMs?: number;
}
