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
- `call()` accepts `signal` and `timeoutMs`. `timeoutMs` (default 10 s) is measured from `call()` entry and covers the readiness wait, `adapter.post()` and the response wait. Timeout creates `BridgeTimeoutError`, reset creates `BridgeResetError`, dispose creates `BridgeDisposedError`, and a `signal` abort rejects with its reason; whichever settles first wins.
- `emit()` waits for readiness and adapter `post()`; it accepts optional per-call `signal` and `timeoutMs` (a `timeoutMs` deadline is measured from `emit()` entry). Without them an emit is unbounded but reclaimable: `reset()` rejects it with `BridgeResetError` and `dispose()` with `BridgeDisposedError`.
- `timeoutMs` (on `createBridge`, `call()` and `emit()`): `undefined` or `NaN` takes the default (10 s for calls, no timer for emits); `<= 0` or `Infinity` arms no timer; finite values above 2,147,483,647 are clamped to it.
- `call()`s and `emit()`s made before readiness post in the order they were made, whatever options they pass.
- `on()` supports `signal` and `once`; listener identity is managed by the bridge.
- Inbound event fan-out follows the ai*js re-entrancy rule for pure fan-out emitters: dispatch is synchronous and depth-first, so a nested dispatch from inside a listener runs to completion before the outer dispatch resumes; the outer dispatch keeps iterating its pre-taken snapshot and skips listeners removed meanwhile; `once` listeners go inert before their first invocation; nested dispatch is never rejected or queued.
- Event-listener throws are isolated and discarded by design — one misbehaving listener cannot abort fan-out to its siblings. Wrap your own handler body in `try/catch` if you need to observe errors.
- `reset()` rejects pending `call()`s and in-flight `emit()`s with `BridgeResetError`, cancels the current readiness round, and forgets cached readiness so the next `ready()`/`call()`/`emit()` re-awaits `adapter.ready()`. Registered `on()` listeners and the adapter subscription are untouched; only `dispose()` removes them.
- A rejected `adapter.ready()` is cached: later `ready()`/`call()`/`emit()` reject with the same error until `reset()` starts a new readiness round.
- The signal passed to `adapter.ready()` is per readiness round; it aborts on `reset()` (reason `BridgeResetError`) and `dispose()` (reason `BridgeDisposedError`). Adapters must detach their listeners on abort.
- `dispose()` is idempotent and permanent: in-flight `call()`s and `emit()`s reject with `BridgeDisposedError` and every listener is removed.
- After `dispose()`, `ready()`, `platform()`, `on()`, and `reset()` throw `BridgeDisposedError` synchronously; `call()` and `emit()` (both `async` functions) reject with it instead.
- Argument misuse throws `BridgeError` (message `aibridgejs: <subject> must be <constraint>`) before any side effect: `createBridge()` without an options object or without an adapter exposing `ready`, `post`, `subscribe` and `dispose` functions; `on()` with a non-function listener; `createIframeAdapter()`/`createFlutterAdapter()` with a host lacking `addEventListener`/`removeEventListener`; a non-object options argument to the Flutter factory or `detectBridgeAdapter()`; an iframe `targetOrigin` that is missing, `"*"`, or not an exact origin.

## Boundaries

- Payload schema validation is caller-owned.
- Binary envelopes and streaming RPC are not implemented.
- iframe security depends on exact `targetOrigin` and, when possible, explicit `expectedSource`.
- `timeoutMs <= 0` disables call timeout and should be paired with an external abort path.
