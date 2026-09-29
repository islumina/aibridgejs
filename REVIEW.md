# aibridgejs Review

Current review state after the 2026-09-29 ai*js 0.6.0 pass. Fixed historical findings are summarised; only still-relevant risks remain expanded.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P3 | Empty or non-string `method` / `event` names | Deferred | `call("")`, `emit("")` and `on("")` are accepted, but every conforming peer (and the bridge's own `isValidEnvelope()`) drops envelopes whose `method`/`event` is not a non-empty string, so such a call can only time out and such an emit or listener is a silent no-op. Deferred: the ai*js 0.6.0 argument-validation rule covers options objects, callbacks and numbers, not names; adding the throw is a breaking change best decided with the 1.0 surface freeze. |
| P3 | Disabled timeout | Documented | `timeoutMs <= 0` can leave a call pending indefinitely unless paired with `AbortSignal` (`reset()`/`dispose()` still reclaim it). |
| P3 | Payload shape | Documented | Payloads are JSON-safe by convention, not runtime schema-validated. |
| P3 | iframe source fallback | Documented | When no `postTarget`/`expectedSource` can be inferred, origin-only validation applies. |

## Fixed Summary

- `call()` deadline covers readiness (0.6.0, P1): `timeoutMs`, including the 10 s default, is armed at `call()` entry and bounds the readiness wait, `adapter.post()` and the response wait; a never-ready adapter now rejects with `BridgeTimeoutError`.
- `reset()` listener survival (0.6.0, P2): code now matches the documented contract — `on()` listeners and the adapter subscription survive `reset()`; only `dispose()` removes them. README, README_ZHTW, STABILITY, JSDoc and llms-full agree.
- Reclaimable `emit()` (0.6.0, P3): every in-flight `call()`/`emit()` lives in one registry that `reset()` (`BridgeResetError`) and `dispose()` (`BridgeDisposedError`) settle; a late `adapter.post()` settlement is ignored.
- Per-round readiness signal (0.6.0, P3): each `adapter.ready()` round gets its own `AbortSignal`, aborted by `reset()`/`dispose()`, so reset-and-retry against a hung `adapter.ready()` no longer accumulates orphaned adapter listeners.
- Argument validation (0.6.0): `createBridge()`, `on()` and the iframe/Flutter/detect factories report misuse as `BridgeError` with an `aibridgejs: ` prefix before any side effect, never a bare `TypeError`.
- Pre-ready `call()`/`emit()` post in FIFO order whatever options they pass (0.6.0).
- `adapter.ready()` goes through the same sync-throw/non-promise wrapper as `adapter.post()` (0.6.0).
- `emit()` per-call cancellation (0.5.8): `EmitOptions { signal?, timeoutMs? }`; its `timeoutMs` also bounds the readiness wait.
- Response getters and reset paths no longer produce unhandled promise races; response, event and envelope-validation paths read each field exactly once inside a guard.
- iframe adapter rejects wildcard, pathful, trailing-slash, and opaque `"null"` origins.
- Flutter adapter feature-checks whether the platform is already ready at construction, so a bridge created after the one-shot ready event no longer waits forever.
- Adapter subscription cleanup is idempotent across reset/dispose.
- `timeoutMs` is normalised before arming a timer: `<= 0`/`Infinity` disable it, `NaN` takes the default, and values above 2,147,483,647 are clamped.
- Package `exports` resolve `.d.cts` types under the `require` condition for every subpath.
- The event fan-out loop skips listeners removed during the same dispatch cycle and stops on `dispose()`.
- `detectBridgeAdapter()` feature-checks the Flutter branch and delegates iframe host/`targetOrigin` validation to `createIframeAdapter()`.
- `ready()`'s synchronous-throw behaviour after `dispose()` (like `platform()`) is pinned by a test and documented in README/STABILITY.

## Closed Without Change

- officalsite playground host bridge: `officalsite/src/pages/playground.astro` uses only `createBridge`, `on('studio/ready' | 'studio/context')` and `emit('studio/command', ..., { timeoutMs: 5000 })`; it never calls `call()` or `reset()`, so the 0.6.0 contract changes affect it only in that its emits become reclaimable on `dispose()`. Not a defect; nothing needs porting. The vendored copy under `/playground/editor/vendor/aibridgejs/` must be refreshed after publish.

## Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:docs`
- `pnpm verify:exports`
- `pnpm verify:dist`
- `pnpm verify:llms`
- `pnpm check:size`
- `pnpm prepublishOnly` (all of the above plus lint, coverage thresholds and build)
