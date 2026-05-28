# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-05-28

### Fixed

- `createIframeAdapter` no longer silently drops every inbound message when
  `expectedSource: undefined` is passed explicitly. The source-check guard now
  treats `null` and `undefined` uniformly as "no source check", matching the
  sentinel semantics used by the `"expectedSource" in options` distinction.

### Changed

- `isValidEnvelope` now rejects envelopes whose `timestamp` is `NaN`,
  `Infinity`, or `-Infinity`. Previously only the `typeof === "number"` check
  ran, which let non-finite numbers through.
- Refactor `bridge.on()` listener registration to use a definite-assigned
  `entry` instead of an `entryRef` indirection object. Behaviour is identical;
  the change is purely for readability.

### Removed (type-level, non-breaking at runtime)

- `BridgeAdapter.post` no longer declares a second `options?: { signal? }`
  parameter. No adapter implementation ever consumed it and `createBridge`
  never passed it, so the runtime contract is unchanged. External adapter
  authors who happened to type the parameter can remove it without code
  changes.
- `BridgePlatform` no longer includes the `"cocos"` string literal. No
  adapter, test, or doc referenced it. Future platforms will be added
  together with their adapter implementation.

### Internal

- `IframeAdapter.dispatchTestMessage` is now annotated `@internal` (JSDoc).
  Still exported for the existing vitest suite, but signalled as not part
  of the public contract.

## [0.1.2] - 2026-05-28

### Security

- Upgrade `vitest` 2.1.9 -> 4.1.7 and `@vitest/coverage-v8` 2.1.9 -> 4.1.7
  to resolve two Dependabot advisories on the transitive dev-only graph:
  - [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
    `esbuild <=0.24.2` CORS development server data leak (fixed in 0.25.0).
  - [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)
    `vite <=6.4.1` path traversal in optimized deps `.map` handling
    (fixed in 6.4.2 / 7.3.2 / 8.0.5).
- Add `vite` 8.0.14 as a direct devDependency to satisfy vitest 4 peer
  range (`^6 || ^7 || ^8`).

### Changed

- Relax statements coverage threshold from 100% to 95%. Vitest 4 with v8
  coverage scores defensive race-recovery if-guards (e.g.
  `if (!current) return;` in timeout/abort/post handlers) as separate
  statements that are not deterministically reachable. Lines and
  functions stay at 100%; branches stays at 90%.

Runtime surface unchanged. Production bundles are byte-identical.

## [0.1.1] - 2026-05-28

### Changed

- No code changes. Patch release to validate the npm publish GitHub Actions
  workflow end-to-end.

## [0.1.0] - 2026-05-28

### Added

- Initial release.
- Core: `createBridge`, `BridgeEnvelope` discriminated union, `BridgeAdapter`
  interface, five error classes (`BridgeError`, `BridgeDisposedError`,
  `BridgeResetError`, `BridgeTimeoutError`, `BridgeRemoteError`).
- Mock adapter (`aibridgejs/mock`): loopback transport with `receive()` test
  hook for unit tests.
- iframe adapter (`aibridgejs/iframe`): `postMessage` transport with mandatory
  exact `targetOrigin` and `event.source` validation; rejects wildcard `*`.
- Flutter adapter (`aibridgejs/flutter`): InAppWebView `callHandler`
  transport with `waitForReadyEvent` gating and `receive()` push entrypoint.
- Detection helper (`aibridgejs/detect`): `detectBridgeAdapter` chooses an
  adapter by inspecting host globals (Flutter -> iframe -> mock).
- Full TDD gate suite: ready gating, ID correlation, timeout rejection,
  abort rejection, malformed discard, origin rejection, dispose rejection.
