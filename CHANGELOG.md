# Changelog

All notable changes to aibridgejs are summarized here. Older release detail was condensed after the 2026-06-10 review wave.

## [Unreleased]

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
