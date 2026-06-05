# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.2] - 2026-06-05

### Docs

- Review-driven documentation fix (`llms-full.txt`; plus repo-only `CONTRIBUTING.md`): clarity from a cross-package code review. No runtime or API change; `dist` byte-identical to 0.5.1.

## [0.5.1] - 2026-06-02

### Fixed

- **Response branch guarded against throwing getters on `error.message`/`error.code`**
  ([src/bridge.ts](src/bridge.ts)): the error-coercion block in the `"response"` switch
  case is now wrapped in `try/catch`. A hostile or buggy host that supplies an error
  object with a throwing getter previously caused the exception to escape the adapter
  callback, leaving the call promise pending indefinitely (hanging past its own
  timeout). The guard catches any such throw and falls back to the same safe defaults
  (`"Remote error"` / `"REMOTE_ERROR"`) already used for missing or non-string fields.
  Well-formed error shapes are unaffected. Regression test added (`A9c` in
  `test/bridge.test.ts`).

- **iframe `expectedSource` null/fallback branches now covered by tests**
  ([test/iframe.test.ts](test/iframe.test.ts)): three cases that were previously
  exercised only implicitly are now tested explicitly:
  (a) `expectedSource: null` passed directly enables origin-only acceptance;
  (b) when no `postTarget` can be inferred, `expectedSource` defaults to `null`
  (origin-only fallback — the security-relevant default-derivation branch);
  (c) a message from the correct origin but a mismatched `event.source` under the
  default parent-inferred config is rejected.

### Recommended CI follow-up (not included — requires `workflows` permission)

- Add a `verify:llms` step to [.github/workflows/ci.yml](.github/workflows/ci.yml)
  (the `verify:llms` script exists and passes locally) so CI guards `llms-full.txt`
  freshness, matching all six sibling repos.
- Rename the test step `"Test with coverage thresholds"` → `"Test (with coverage thresholds)"`
  to match the sibling-repo form.

  These two `.github/workflows/ci.yml` edits are intentionally omitted from this
  branch because the automation pushing it lacks the GitHub `workflows` permission;
  a maintainer should apply them directly.

### Changed (docs)

- **`createIframeAdapter` JSDoc clarifies `expectedSource` contract**
  ([src/iframe/index.ts](src/iframe/index.ts)): documents that omitting `postTarget`
  when no target can be inferred yields `expectedSource: null` (origin-only
  validation, source check disabled); that exact-origin allowlisting is the primary
  security gate; and that the `event.source` check is defense-in-depth. No behavior
  change.

## [0.4.1] - 2026-05-29

Consistency patch — CI workflow and documentation hygiene. No runtime API
change; `dist/` is byte-identical to 0.4.0.

### Changed (CI)

- **`publish.yml` now passes `--provenance --access public` explicitly**
  ([.github/workflows/publish.yml](.github/workflows/publish.yml)), matching the
  rest of the ai*js family. This makes intent explicit rather than fixing a
  behaviour gap: 0.4.0 was already published with SLSA provenance (npm OIDC
  Trusted Publishing enables it automatically) and `--access public` is the
  default for this unscoped package. The explicit flags keep the workflow
  consistent with its siblings and robust if npm's defaults change.

### Removed (repo-only; not shipped in the npm tarball)

- **`STABILITY_ZHTW.md`**: the Traditional-Chinese mirror of the stability
  contract is removed to match the family convention — the English
  `STABILITY.md` is the single source. The language-switcher line atop
  `STABILITY.md` is removed with it, and `README_ZHTW.md`'s stability link now
  points to `STABILITY.md`.

### Compatibility

Non-breaking: no new exports, no removed exports, no signature changes.
`dist/` bundles are byte-identical to 0.4.0; the published tarball differs only
in `README_ZHTW.md` (one documentation link) and `llms-full.txt` (regenerated
from the trimmed `STABILITY.md` and this changelog).

## [0.4.0] - 2026-05-29

Dependency-hygiene milestone and 1.0-track stability freeze. **No runtime API
addition; the production bundle is byte-identical to 0.3.2.**

### Changed (stability)

- **0.3.x public surface declared frozen for the 1.0 track**
  ([STABILITY.md](STABILITY.md), `STABILITY_ZHTW.md`): every
  `stable` export — core `createBridge`, the five error classes, and all four
  adapter / detect entrypoints with their types — is now committed to
  additive-only evolution until 1.0. The two `experimental` design-note items
  (binary envelope, streaming RPC) are explicitly excluded and remain targeted
  no earlier than v0.7.

### Dependency hygiene (dev-only; not shipped in the npm tarball)

- **Verified minimal; no reduction available.** Zero runtime `dependencies` and
  zero `peerDependencies` (unchanged since 0.1.0). The nine devDependencies are
  already aligned to the ai*js family-canonical versions; `depcheck` reports no
  unused or missing dependency, `pnpm audit` reports no known vulnerability at
  moderate or above, and `pnpm dedupe --check` finds no deduplication
  opportunity. CI workflow actions are pinned to the current `@v6` majors
  (`actions/checkout`, `actions/setup-node`, `pnpm/action-setup`). This
  release records the audited-clean baseline rather than changing it.

### Compatibility

Non-breaking: no new exports, no removed exports, no signature changes, no
default-behaviour change. A version-line unification (aligning aibridgejs with
the ai*js family's 0.4.0) plus a documentation-level stability commitment.
`dist/` bundles are byte-identical to 0.3.2; only `llms-full.txt` changes,
reflecting the updated STABILITY.md and CHANGELOG.md it embeds.

## [0.3.2] - 2026-05-29

Findings from a second independent Codex review pass.

### Fixed (resource leaks)

- **Adapter `dispose()` invokes each subscription's unsubscribe** ([src/mock/index.ts](src/mock/index.ts), [src/iframe/index.ts](src/iframe/index.ts), [src/flutter/index.ts](src/flutter/index.ts)): `dispose()` previously called only `subscribers.clear()`, leaving any `"abort"` listener registered on an externally-supplied `AbortSignal` orphaned until that signal eventually fires. Each adapter now maintains a `subCleanups` registry and iterates it in `dispose()`, completing the 0.3.1 `subscribe()` unsubscribe cleanup so a disposed adapter fully releases listeners held on external signals.

### Fixed (docs)

- **Completed `event.source` opt-out wording in Security tables** ([README.md](README.md), [README_ZHTW.md](README_ZHTW.md), [llms.txt](llms.txt)): the 0.3.1 fix updated `STABILITY.md` and prose sections but missed the iframe Security tables and the `llms.txt` index sentence. Wording now consistently reflects that source-checking can be disabled with `expectedSource: null`.
- **Corrected Vitest example from `environment: 'jsdom'` to `'node'`** ([README.md](README.md), [README_ZHTW.md](README_ZHTW.md)): `jsdom` was removed as a devDependency in 0.3.1; the example config now matches the actual test environment.
- **Removed an unimplemented `BridgeDisposedError` trigger from the error table** ([README.md](README.md), [README_ZHTW.md](README_ZHTW.md)): the table claimed the iframe adapter raises it when it "detects its target window vanished" — no such detection exists; the adapter raises `BridgeDisposedError` only on explicit `dispose()`.
- **Qualified the `AbortSignal` claim in `llms.txt`**: `ready()` and `call()` accept an `AbortSignal`; `emit()` is fire-and-forget and takes none. The previous "all async methods" wording overstated the surface.

### Compatibility

Non-breaking; no API change. The leak fix only affects the dispose path for subscriptions made with an external `AbortSignal`.

## [0.3.1] - 2026-05-29

All five findings below originated from an independent Codex review of the
0.3.0 runtime. None are breaking.

### Fixed (correctness)

- **`createBridge` coerces malformed remote-error fields** ([src/bridge.ts](src/bridge.ts)): a `response` envelope with a non-string `error.code` / `error.message` could surface a non-string on `BridgeRemoteError`, whose `code` / `message` are typed `string`. The bridge now falls back to `"REMOTE_ERROR"` / `"Remote error"` when a field is missing or the wrong type, so a malformed host cannot violate the error type contract. Well-formed string errors are unchanged.

### Fixed (resource leaks)

- **`ready()` detaches its dispose listener on every settle path** ([src/bridge.ts](src/bridge.ts)): repeated `reset()` against a hung `adapter.ready()` previously left one orphaned `"abort"` listener per round on the internal signal until `dispose()`. The reset path now removes the round's listener. No behavioural change — the identity guard already prevented double-settle.
- **Adapter `subscribe()` unsubscribe detaches its signal listener** ([src/mock/index.ts](src/mock/index.ts), [src/iframe/index.ts](src/iframe/index.ts), [src/flutter/index.ts](src/flutter/index.ts)): the returned unsubscribe now calls `signal.removeEventListener("abort", ...)`, mirroring `bridge.on()`. Manual unsubscribe with a long-lived `AbortSignal` no longer accumulates listeners.

### Fixed (docs)

- **iframe `event.source` validation documented as opt-out, not absolute** ([README.md](README.md), [README_ZHTW.md](README_ZHTW.md), [STABILITY.md](STABILITY.md), `STABILITY_ZHTW.md`): the docs claimed `event.source` is validated on every inbound message; source-checking can in fact be disabled with `expectedSource: null` (intentional since 0.1.3). Wording now matches the contract.
- **Removed stale `'cocos'` from the documented `platform()` union** ([README.md](README.md), [README_ZHTW.md](README_ZHTW.md), [llms.txt](llms.txt)): the literal was dropped from `BridgePlatform` in 0.1.3 but lingered in the API docs. Now `'iframe' | 'flutter' | 'mock' | 'unknown'`, matching `src/types.ts`.

### Internal (not shipped in the npm tarball)

- Test-suite hardening: dropped the unused `jsdom` devDependency (tests run on the `node` environment), added a `fast-check` property test for request/response id-correlation under arbitrary response ordering, and added a `ready()` mid-flight abort test plus regression tests for the fixes above. **112 tests**; coverage 97.88 / 91.86 / 100 / 100.

### Compatibility

Non-breaking: no new exports, no removed exports, no signature changes. The remote-error coercion and listener-cleanup fixes only alter behaviour for malformed input or pathological reset/churn scenarios; well-formed usage is unchanged. All subpath bundles stay within their gzip budgets.

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
