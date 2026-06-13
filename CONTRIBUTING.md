# Contributing to aibridgejs

Keep the bridge core transport-agnostic and move host quirks into adapters.

## Local workflow

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm verify:docs
pnpm build:llms
pnpm verify:llms
pnpm check:size
```

Run `pnpm lint` before PRs. If docs change, regenerate `llms-full.txt`.

## Rules

- Do not weaken iframe origin/source checks.
- Keep envelopes JSON-safe and adapter-neutral.
- Preserve `AbortSignal` semantics for `ready()` and `call()`.
- Keep `emit()` behavior explicit until its API is intentionally expanded.
- Add tests for reset/dispose/timeout paths when bridge state changes.

## License

MIT
