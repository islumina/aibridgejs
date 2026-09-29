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
- Preserve `AbortSignal` semantics for `ready()`, `call()` and `emit()`.
- Keep every in-flight `call()` and `emit()` reclaimable by `reset()` and `dispose()`.
- Add tests for reset/dispose/timeout paths when bridge state changes.

## License

MIT
