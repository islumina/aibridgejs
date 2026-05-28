# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
