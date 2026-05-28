# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-05-29

### Added (docs)

- **`STABILITY.md` + `STABILITY_ZHTW.md`**: per-export stability contract and per-subpath **pure-web safety** labels. Each subpath now carries one of four tags: `pure-web safe`, `pure-web safe (auto-fallback)`, `requires native shell`, `dev only`. Consumers no longer need to read adapter source to judge whether a subpath is safe to import in a pure-web page (no iframe parent, no native shell). The contract also lodges placeholder design notes for the two long-running [draft] limitations (binary envelope, streaming RPC) so they have a stable URL before any implementation lands.

### Changed (docs)

- **`README.md` + `README_ZHTW.md`** subpath table and each adapter section now carry pure-web safety annotations and link to `STABILITY.md` for the full contract.
- **JSDoc on `createMockAdapter` / `createIframeAdapter` / `createFlutterAdapter` / `detectBridgeAdapter`**: each factory now opens with a one-line pure-web safety statement plus a link to `STABILITY.md`. No signature changes.

### Changed (tooling)

- **`scripts/build-llms-full.mjs`** now includes `STABILITY.md` in the concatenated `llms-full.txt`, so LLM-facing context exposes the stability contract in the same fetch. Source documents in order: `README.md` → `STABILITY.md` → `CHANGELOG.md` → `CONTRIBUTING.md`.

### Compatibility

This release is **runtime-identical to 0.2.1**. No new exports, no removed exports, no signature changes. Bundle gzip stays well within budget for every subpath (measured at index 2351 / mock 753 / iframe 1161 / flutter 1243 / detect 1900 B; budgets unchanged). Coverage maintained at 97.86 / 91.38 / 100 / 100.

## [0.2.1] - 2026-05-28

### Changed (CI)

- **`publish.yml` now triggers on `push: tags: ["v*"]`** instead of `release: published`. Aligns with the trigger used by `aifsmjs` and `aiecsjs` in the same ai*js family. Prior to this, a manual `gh release create vX.Y.Z` was required after every tag push to fire the publish workflow.
- **`publish.yml` now runs `verify:llms`** in the gate chain (was already in `prepublishOnly` via the new 0.2.0 script, but now also visible as a CI step for faster failure attribution).

### Changed (docs)

- **README opening unified across the ai*js family**: five-badge shields row (npm + CI + License + AI Generated + 繁體中文/English), one-line tagline as blockquote, ecosystem footer linking to the other two packages. Same shape in `README.md` and `README_ZHTW.md`.

## [0.2.0] - 2026-05-28

### Fixed (correctness)

- **`reset()` settles ready waiters parked on a slow `adapter.ready()`** ([src/bridge.ts](src/bridge.ts)): previously `reset()` cleared only the `pending` map (entries written after ready resolved). Calls awaiting a slow / hung `adapter.ready()` never reached `pending` and stayed parked indefinitely past reset. The cached `readyPromise`'s rejecter is now captured and invoked from `reset()`, so in-flight `call()` / `ready()` waiters surface a `BridgeResetError` synchronously. The captured rejecter uses an **identity guard** before clearing the module-level slot, so a stale `adapter.ready()` resolution arriving AFTER reset cannot clobber the new round's reject handle (regression caught by the round-2 review).

### Documentation

- **`generateId()` carries a SECURITY JSDoc** ([src/internal.ts](src/internal.ts)): the `Math.random()` fallback used on legacy WebViews is now explicitly documented as not cryptographically strong. Callers crossing a real trust boundary should layer a signed nonce on top of the envelope payload rather than relying on ID unpredictability.

### Removed (packaging)

- **Removed Traditional-Chinese llms files** (`llms_ZHTW.txt`, `llms-full_ZHTW.txt`): aibridgejs was the only ai*js package shipping localised LLM files; aifsmjs and aiecsjs ship English llms only. LLM agents ground in English; the ~27 KB of duplicated content was net cost (extra tarball size + sync burden) for no consumer. `README_ZHTW.md` and human-facing translations stay.

### Added (tooling)

- **`verify:llms` gate** ([scripts/build-llms-full.mjs](scripts/build-llms-full.mjs)): the script now accepts `--check`, which builds the file in memory and exits non-zero if it differs from disk. Wired into `prepublishOnly`. Works pre-commit and in CI alike (the previous form would have required `git diff --exit-code`, which fails any time the working tree has uncommitted changes).

### Changed (API)

- `Bridge.call` is now generic: `call<T = unknown>(method, payload?, options?): Promise<T>`. Existing callers that omit the type parameter keep `Promise<unknown>` and are unaffected. Casts like `as { token: string }` should be replaced with `bridge.call<{ token: string }>(...)`. The runtime does NOT validate the response — the generic is a caller assertion; validate with Zod / Valibot at the boundary when the host is untrusted.

### Documentation

- New "Error semantics (retry table)" section in `README.md`, `README_ZHTW.md`, and `llms-full.txt`. Each of the five error classes is now tagged retryable / not retryable, with the recommended caller response and an idiomatic `callWithReset()` helper.
- All `bridge.call(...) as { ... }` examples migrated to the new `bridge.call<{ ... }>(...)` form.

### Compatibility

This release is **non-breaking at runtime**. Source compatibility is preserved for callers that did not pin the response type. Callers using `as`-style casts can keep them; the new generic form is the recommended replacement.

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
