# aibridgejs

Transport-agnostic bridge core for iframe, Flutter InAppWebView, and in-memory mock runtimes. It moves JSON-safe request/response/event envelopes across an adapter while keeping host coupling outside the core.

> **Status: 0.6.0 - stable 1.0-track core.** Root, mock, iframe, flutter, and detect subpaths are shipped.

## Install

```bash
pnpm add aibridgejs
```

```ts
import { createBridge } from "aibridgejs";
import { createIframeAdapter } from "aibridgejs/iframe";
```

## Quick Start

```ts
const bridge = createBridge({
  adapter: createIframeAdapter(window, {
    targetOrigin: "https://host.example",
    expectedSource: window.parent,
  }),
  timeoutMs: 5000,
});

bridge.on("theme/change", (payload) => {
  console.log("theme", payload);
});

const user = await bridge.call<{ name: string }>("user/current");
await bridge.emit("analytics/event", { name: "opened" });
```

## Core API

- `createBridge({ adapter, timeoutMs? })` creates a bridge around one adapter.
- `bridge.ready({ signal }?)` waits for adapter readiness.
- `bridge.call<T>(method, payload?, { timeoutMs, signal }?)` sends a request and resolves with the remote response payload. `timeoutMs` (default 10 s) is measured from `call()` entry and covers the readiness wait, `adapter.post()` and the response wait.
- `bridge.emit(event, payload?, { signal, timeoutMs }?)` sends a fire-and-forget event after readiness; the optional `signal` / `timeoutMs` cancel or time-bound a single emit.
- `bridge.on<T>(event, listener, { signal, once }?)` subscribes to inbound events; `listener` must be a function.
- `bridge.platform()` returns `"iframe"`, `"flutter"`, `"mock"`, or `"unknown"`.
- `bridge.reset()` rejects pending `call()`s and in-flight `emit()`s with `BridgeResetError`, cancels the current readiness round, and forgets cached readiness so the next `ready()`/`call()`/`emit()` re-awaits `adapter.ready()`. Registered `on()` listeners and the adapter subscription are untouched; only `dispose()` removes them.
- `bridge.dispose()` is idempotent, permanent teardown: in-flight `call()`s and `emit()`s reject with `BridgeDisposedError` and every listener is removed.

## Adapters

| Subpath | Use | Notes |
| --- | --- | --- |
| `aibridgejs/mock` | Tests and local simulations | In-memory loopback; not for production traffic. |
| `aibridgejs/iframe` | `postMessage` bridges | Requires exact `targetOrigin`; `"*"` is rejected. Optional `expectedSource` adds source checking. |
| `aibridgejs/flutter` | Flutter InAppWebView | Uses `window.flutter_inappwebview.callHandler`; readiness is feature-checked. |
| `aibridgejs/detect` | Host selection | Chooses flutter/iframe/mock based on host capabilities. |

Custom adapters implement `ready`, `post`, `subscribe` and `dispose`. The signal passed to `ready()` is per readiness round; it aborts on `reset()` (reason `BridgeResetError`) and `dispose()` (reason `BridgeDisposedError`); adapters must detach their listeners on abort.

## Sharp Edges

- Payloads must be JSON-safe. The bridge does not validate cloneability or schema; validate at app boundaries.
- `call()` and `emit()` both support per-call `signal` and `timeoutMs`. For `emit()` these are opt-in: omitted, it is unbounded but reclaimable (it waits for readiness and adapter `post()` with no time bound; only `reset()` or `dispose()` settle it early).
- `timeoutMs <= 0` or `Infinity` disables the timer, `NaN` falls back to the default, and values above 2,147,483,647 are clamped to it. Pair a disabled timer with an `AbortSignal` if the remote side may hang.
- `reset()` rejects pending `call()`s and in-flight `emit()`s with `BridgeResetError`; registered `on()` listeners and the adapter subscription are untouched, and only `dispose()` removes them.
- A rejected `adapter.ready()` is cached: later `ready()`/`call()`/`emit()` reject with the same error until `reset()` starts a new readiness round.
- iframe security depends on exact origin allowlisting. Pass `expectedSource` whenever same-origin pages share the channel.
- Flutter readiness failures are adapter-level errors; keep native handler names stable across app releases.
- Misuse throws `BridgeError` with an `aibridgejs: ` message prefix before any side effect: a missing options object, an adapter or host missing required methods, a non-function listener, or an iframe `targetOrigin` that is not an exact origin.
- Event-listener throws are isolated and discarded by design — one misbehaving listener cannot abort fan-out to its siblings. Wrap your own handler body in `try/catch` if you need to observe errors.
- After `dispose()`, `ready()`, `platform()`, `on()`, and `reset()` throw `BridgeDisposedError` synchronously rather than rejecting — unlike `call()`/`emit()`, which reject. Code that assumes `bridge.ready().then(...).catch(...)` will crash the caller if the bridge is already disposed.

## AI Context

- Short index: [`llms.txt`](llms.txt)
- Full generated context: [`llms-full.txt`](llms-full.txt)
- Stability contract: [`STABILITY.md`](STABILITY.md)
- Current review backlog: [`REVIEW.md`](REVIEW.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
