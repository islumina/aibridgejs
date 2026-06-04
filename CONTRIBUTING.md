# Contributing to aibridgejs

Thanks for taking the time to contribute. This project follows a small set of
non-negotiable rules to keep the surface area honest and the test suite the
authoritative spec.

## Ground rules

- **Tests are the specification.** Any new behaviour must come with a test.
  Any bug fix must come with a failing test that the fix makes pass.
- **TDD gate cases must always pass.** See the seven gate cases in
  [README.md](README.md#tdd-gate-cases). A PR that fails any gate is rejected.
- **Core stays pure.** `src/index.ts` and `src/bridge.ts` must not import
  from `svelte`, `pixi.js`, `window`, `flutter_inappwebview`, or any other
  host-global. All host coupling lives behind the `BridgeAdapter` interface.
- **Public APIs accept `AbortSignal`.** Every async public method must accept
  a `signal` option that, when fired, settles the in-flight work and removes
  any associated state from internal maps.
- **`dispose()` cleans everything.** Any new long-lived resource (timer,
  listener, pending entry, native handle) must be released by `dispose()`.

## Local workflow

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm coverage
pnpm build
pnpm verify:exports
pnpm verify:llms
pnpm check:size
```

All commands above must pass before opening a PR. `pnpm prepublishOnly` runs
them in order as the final gate.

## Reporting bugs

Open an issue with a minimal failing test case using the mock adapter. The
mock adapter has no host dependency, so a reproduction can be a 20-line
Vitest file. See `test/bridge.test.ts` for the shape.

## Reporting security issues

Do not file public issues for security problems. Email the maintainer
listed in `package.json` and allow time for a private fix before public
disclosure.
