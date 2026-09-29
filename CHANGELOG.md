# Changelog

All notable changes to aibridgejs are summarized here. Older release detail was condensed after the 2026-06-10 review wave.

## [0.6.0] - 2026-09-29

### Breaking

- `call()`: `timeoutMs` (including the 10 s default) is now measured from `call()` entry and covers the readiness wait, `adapter.post()` and the response wait, so a never-ready adapter rejects with `BridgeTimeoutError` instead of hanging forever. Migration: callers that intentionally relied on an unbounded readiness wait must pass `timeoutMs: 0` with their own `AbortSignal`.
- `reset()`: registered `on()` listeners and the adapter subscription now survive `reset()`, as README and STABILITY already promised, and only `dispose()` removes them. Migration: code that used `reset()` to drop listeners must call the returned unsubscribe functions or `dispose()`.
- `emit()`: an in-flight `emit()` without `signal`/`timeoutMs` is now rejected by `reset()` (`BridgeResetError`) and `dispose()` (`BridgeDisposedError`) instead of staying pinned on a hung transport and leaking the bridge. Migration: callers awaiting an option-less `emit()` across `reset()`/`dispose()` should catch `BridgeResetError`/`BridgeDisposedError`.
- `createBridge()` / `bridge.on()`: a missing options object or an adapter without `ready`, `post`, `subscribe` and `dispose` functions now throws `BridgeError` at construction, and `on()` throws `BridgeError` for a non-function listener instead of registering it silently. Migration: pass a complete `BridgeAdapter` (stub any method you do not use) and a function listener, and catch `BridgeError` rather than `TypeError`.
- `createIframeAdapter()` / `createFlutterAdapter()` / `detectBridgeAdapter()`: argument misuse (a host without `addEventListener`/`removeEventListener`, a non-object options argument, or a missing, `"*"` or non-exact `targetOrigin`) now throws `BridgeError` with an `aibridgejs: ` message prefix instead of a bare `Error` or `TypeError`. Migration: match these errors with `instanceof BridgeError` (still an `Error` subclass) instead of the old message text.

### Changes

- Changed: the signal passed to `adapter.ready()` is now per readiness round and aborts on `reset()` (reason `BridgeResetError`) as well as `dispose()` (reason `BridgeDisposedError`), so repeated reset-and-retry against a hung `adapter.ready()` no longer accumulates orphaned adapter listeners; adapters must detach their listeners on abort (the Flutter adapter already does).
- Changed: argument-misuse messages follow the ai*js shape `aibridgejs: <subject> must be <constraint>`; the three iframe `targetOrigin` messages are merged into one.
- Fixed: `emit()`'s `timeoutMs` now also bounds the readiness wait, not just the post-readiness phase, matching the documented `EmitOptions.timeoutMs` contract.
- Fixed: the Flutter adapter now feature-checks whether the platform is already ready at construction, so a bridge created after the one-shot `flutterInAppWebViewPlatformReady` event no longer waits forever.
- Fixed: `timeoutMs` (the `createBridge` default, per-call, and per-emit) is normalized before arming a timer — non-finite values (e.g. `Infinity`) and values above the 32-bit timer limit no longer fire almost immediately, and `NaN` falls back to the default instead of silently disabling the timer.
- Fixed: package.json `exports` now resolve `.d.cts` types under the `require` condition for every subpath, so CommonJS consumers on `node16`/`nodenext` module resolution can typecheck against the package.
- Fixed: the event fan-out loop no longer invokes listeners removed during the same dispatch cycle, via `dispose()`, `reset()`, their own `unsubscribe()`, or a sibling's signal abort.
- Fixed: `adapter.post()` is now called through a safe wrapper in `call()` and `emit()`, so a custom adapter that throws synchronously or returns a non-promise no longer leaks the pending entry's timer and abort listener.
- Fixed: `isValidEnvelope()` and the event dispatch path now read each envelope field exactly once inside a guard, so a throwing or value-varying getter on an in-process envelope can no longer escape into the adapter's dispatch loop or hand different listeners different payload values.
- Fixed: `detectBridgeAdapter()` now feature-checks the iframe branch the same way it already does for Flutter, so a host with a `parent` but no `addEventListener`/`removeEventListener` gets a descriptive error instead of a raw `TypeError`.
- Fixed: `call()` and `emit()` made before readiness now post in the order they were made whatever options they pass; a `signal` or `timeoutMs` used to add a microtask hop that let a later option-less operation overtake.
- Fixed: `adapter.ready()` is now called through the same wrapper as `adapter.post()`, so a custom adapter whose `ready()` throws synchronously or returns a non-promise no longer leaves a listener behind or rejects every call with a `TypeError`.
- Docs: STABILITY documents the ai*js re-entrancy clause for inbound event fan-out, the `timeoutMs` normalisation rule and that a rejected `adapter.ready()` is cached until `reset()`; README/README_ZHTW describe the per-round adapter signal; CONTRIBUTING no longer calls the `emit()` API unexpanded.

## [0.5.9] - 2026-06-29

- Docs: corrected the stale `emit()` cancellation backlog row (per-call `signal` / `timeoutMs` shipped in 0.5.8) and documented that event-listener throws are isolated/discarded by design; refreshed a stale build-script comment.

## [0.5.8] - 2026-06-14

- Added: `emit(event, payload?, options?)` accepts an optional `EmitOptions { signal?, timeoutMs? }` for per-call cancellation and timeout, mirroring `call()`. Opt-in and fully backwards-compatible — omitting the options preserves the prior fire-and-forget behaviour. A positive `timeoutMs` rejects with `BridgeTimeoutError`; a `signal` abort rejects with its reason; `timeoutMs <= 0` disables the timer.
- Documentation-only slimming pass across README, stability notes, review backlog, and LLM context.

## [0.5.6] - 2026-06-10

- Hardened iframe origin/source checks and Flutter readiness behavior.
- Clarified pending-call reset semantics, response getter safety, and adapter isolation.
- Regenerated the generated LLM context from canonical docs.

## Older releases

- `0.5.5` through `0.5.1` fixed docs drift, slow-ready reset handling, iframe origin normalization, and Flutter unhandled rejection handling.
- `0.4.x` declared the 1.0-track stability surface and removed repo-only baggage from the shipped tarball.
- `0.3.x` focused on resource leak fixes and adapter correctness.
- `0.2.x` added security hardening for iframe origin checks and shaped the public protocol.
- `0.1.x` introduced `createBridge`, typed envelopes, mock/iframe adapters, errors, and CI gates.
