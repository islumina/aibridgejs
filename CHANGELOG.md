# Changelog

All notable changes to aibridgejs are summarized here. Older release detail was condensed after the 2026-06-10 review wave.

## [Unreleased]

- Fixed: `emit()`'s `timeoutMs` now also bounds the readiness wait, not just the post-readiness phase, matching the documented `EmitOptions.timeoutMs` contract.
- Fixed: the Flutter adapter now feature-checks whether the platform is already ready at construction, so a bridge created after the one-shot `flutterInAppWebViewPlatformReady` event no longer waits forever.
- Fixed: `timeoutMs` (the `createBridge` default, per-call, and per-emit) is normalized before arming a timer — non-finite values (e.g. `Infinity`) and values above the 32-bit timer limit no longer fire almost immediately, and `NaN` falls back to the default instead of silently disabling the timer.
- Fixed: package.json `exports` now resolve `.d.cts` types under the `require` condition for every subpath, so CommonJS consumers on `node16`/`nodenext` module resolution can typecheck against the package.
- Fixed: the event fan-out loop no longer invokes listeners removed during the same dispatch cycle, via `dispose()`, `reset()`, their own `unsubscribe()`, or a sibling's signal abort.
- Fixed: `adapter.post()` is now called through a safe wrapper in `call()` and `emit()`, so a custom adapter that throws synchronously or returns a non-promise no longer leaks the pending entry's timer and abort listener.
- Fixed: `isValidEnvelope()` and the event dispatch path now read each envelope field exactly once inside a guard, so a throwing or value-varying getter on an in-process envelope can no longer escape into the adapter's dispatch loop or hand different listeners different payload values.
- Fixed: `detectBridgeAdapter()` now feature-checks the iframe branch the same way it already does for Flutter, so a host with a `parent` but no `addEventListener`/`removeEventListener` gets a descriptive error instead of a raw `TypeError`.

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
