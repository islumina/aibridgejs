# aibridgejs Review

Current review state after the 2026-09-28 ai*js pass. Fixed historical findings are summarized; only still-relevant risks remain expanded.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P1 | `call()` timeout excludes the readiness wait | Open | `timeoutMs`, including the 10 s default, is armed only after `await ready()`. If `adapter.ready()` hangs (e.g. a Flutter platform-ready event that never fires), `call()` never times out — only `reset()`/`dispose()`/a caller `signal` settle it. Fix: start the deadline at `call()` entry and race it against readiness too. `apiChange: true` (changes when the default path can reject), so deferred to a planned minor. |
| P2 | `reset()` docs/code disagree on listener survival | Open | README/STABILITY say `reset()` "resubscribes to adapter messages" and listeners "stay registered on the new subscription"; the code's `unsubscribeAllListeners()` removes every `on()` listener and never refreshes the adapter subscription. Fix: pick one contract and align code, tests, and docs (README, README_ZHTW, STABILITY, llms-full.txt). `apiChange: true`. |
| P3 | `emit()` unbounded without options | Open | An `emit()` called **without** `signal` or `timeoutMs` on a hung `adapter.post()` is unbounded and NOT reclaimable by `reset()` or `dispose()` — it stays in-flight until the transport settles. Always pass `signal` or `timeoutMs` for bounded teardown. Fix (tracking `pending`-style registry settled by `reset()`/`dispose()`) is `apiChange: true`, deferred. |
| P3 | `reset()` doesn't cancel the prior epoch's `adapter.ready()` | Open | `reset()` drops the cached `readyPromise` but the old round's `adapter.ready(internalController.signal)` call (and its listeners) stays live until `dispose()`, since the signal passed to it is shared across all rounds. Each reset-and-retry against a permanently hung `adapter.ready()` adds another orphaned adapter-side listener. Fix: give each `ready()` round its own `AbortController` linked to `internalController`, abort it in `reset()`. Deferred: touches the most delicate part of `ready()`'s abort/identity-guard wiring (`readyReject`, `onDisposed`) — better done as a focused, reviewed follow-up than an inline patch. |
| P3 | Disabled timeout | Documented | `timeoutMs <= 0` can leave a call pending indefinitely unless paired with `AbortSignal`. |
| P3 | Payload shape | Documented | Payloads are JSON-safe by convention, not runtime schema-validated. |
| P3 | iframe source fallback | Documented | When no `postTarget`/`expectedSource` can be inferred, origin-only validation applies. |

## Fixed Summary

- `emit()` per-call cancellation (shipped 0.5.8): `EmitOptions { signal?, timeoutMs? }` allow aborting or time-bounding individual `emit()` calls.
- `emit()`'s `timeoutMs` now also bounds the readiness wait, not just the post-readiness phase, matching its documented contract.
- Response getters and reset paths no longer produce unhandled promise races.
- iframe adapter rejects wildcard, pathful, trailing-slash, and opaque `"null"` origins.
- Flutter adapter feature-checks whether the platform is already ready at construction, not just the host's listener capability, so a bridge created after the one-shot ready event no longer waits forever.
- Adapter subscription cleanup is idempotent across reset/dispose.
- `timeoutMs` (default, per-call, per-emit) is normalized before arming a timer: non-finite/overflow values are disabled instead of firing almost immediately, and `NaN` falls back to the default instead of silently disabling the timer.
- Package `exports` resolve `.d.cts` types under the `require` condition for every subpath, so CJS consumers on `node16`/`nodenext` resolution can typecheck against the package.
- The event fan-out loop no longer invokes listeners removed during the same dispatch cycle (`dispose()`, `reset()`, their own `unsubscribe()`, or a sibling's signal abort).
- `adapter.post()` is called through a safe wrapper in `call()`/`emit()`, so a custom adapter that throws synchronously or returns a non-promise no longer leaks the pending entry's timer and abort listener.
- `isValidEnvelope()` and the event dispatch path read each envelope field exactly once inside a guard, closing a throwing/value-varying-getter escape.
- `detectBridgeAdapter()` feature-checks the iframe branch the same way it already does for Flutter.
- `ready()`'s synchronous-throw behavior after `dispose()` (like `platform()`) is now pinned by a test and documented in README/STABILITY.

## Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:docs`
- `pnpm verify:exports`
- `pnpm verify:dist`
- `pnpm verify:llms`
- `pnpm check:size`
