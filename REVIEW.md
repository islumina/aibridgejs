# aibridgejs Review

Current review state after the 2026-06-10 ai*js pass. Fixed historical findings are summarized; only still-relevant risks remain expanded.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P2 | `emit()` cancellation | Open | `emit()` has no per-call `signal` or timeout. If adapter readiness or `post()` hangs, callers must reset/dispose externally. |
| P3 | Disabled timeout | Documented | `timeoutMs <= 0` can leave a call pending indefinitely unless paired with `AbortSignal`. |
| P3 | Payload shape | Documented | Payloads are JSON-safe by convention, not runtime schema-validated. |
| P3 | iframe source fallback | Documented | When no `postTarget`/`expectedSource` can be inferred, origin-only validation applies. |

## Fixed Summary

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
