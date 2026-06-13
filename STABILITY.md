# Stability Contract

aibridgejs keeps a small stable bridge core and isolates host-specific behavior in subpath adapters.

## Stable Surface

| Surface | Status | Notes |
| --- | --- | --- |
| `aibridgejs` | Stable | `createBridge`, errors, envelope/adapter/bridge types. |
| `aibridgejs/mock` | Stable for tests | In-memory adapter with `receive()`. |
| `aibridgejs/iframe` | Stable | Exact-origin `postMessage` adapter; wildcard origin rejected. |
| `aibridgejs/flutter` | Stable | Flutter InAppWebView adapter and host types. |
| `aibridgejs/detect` | Stable | Capability-based adapter selection helper. |

## Behavioral Contract

- `call()` creates a request envelope, waits for readiness, posts through the adapter, and resolves/rejects from matching response envelopes.
- `call()` accepts `signal` and `timeoutMs`; timeout creates `BridgeTimeoutError`, reset creates `BridgeResetError`, dispose creates `BridgeDisposedError`.
- `emit()` is fire-and-forget but still waits for readiness and adapter `post()`; it accepts optional per-call `signal` and `timeoutMs` (opt-in; omitted preserves the unbounded fire-and-forget contract).
- `on()` supports `signal` and `once`; listener identity is managed by the bridge.
- `reset()` rejects pending calls and refreshes the adapter subscription without disposing the adapter.
- `dispose()` is idempotent and permanent.

## Boundaries

- Payload schema validation is caller-owned.
- Binary envelopes and streaming RPC are not implemented.
- iframe security depends on exact `targetOrigin` and, when possible, explicit `expectedSource`.
- `timeoutMs <= 0` disables call timeout and should be paired with an external abort path.
