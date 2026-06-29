# aibridgejs Review

Current review state after the 2026-06-10 ai*js pass. Fixed historical findings are summarized; only still-relevant risks remain expanded.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P2 | `emit()` unbounded without options | Open | An `emit()` called **without** `signal` or `timeoutMs` on a hung `adapter.post()` is unbounded and NOT reclaimable by `reset()` or `dispose()` — it stays in-flight until the transport settles. Always pass `signal` or `timeoutMs` for bounded teardown. |
| P3 | Disabled timeout | Documented | `timeoutMs <= 0` can leave a call pending indefinitely unless paired with `AbortSignal`. |
| P3 | Payload shape | Documented | Payloads are JSON-safe by convention, not runtime schema-validated. |
| P3 | iframe source fallback | Documented | When no `postTarget`/`expectedSource` can be inferred, origin-only validation applies. |

## Fixed Summary

- `emit()` per-call cancellation (shipped 0.5.8): `EmitOptions { signal?, timeoutMs? }` allow aborting or time-bounding individual `emit()` calls. The remaining open risk (above) is the opt-out no-options path only.
- Response getters and reset paths no longer produce unhandled promise races.
- iframe adapter rejects wildcard, pathful, trailing-slash, and opaque `"null"` origins.
- Flutter adapter feature-checks readiness and sinks async post failures.
- Adapter subscription cleanup is idempotent across reset/dispose.

## Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:docs`
- `pnpm verify:exports`
- `pnpm verify:dist`
- `pnpm verify:llms`
- `pnpm check:size`
