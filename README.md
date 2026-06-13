# aibridgejs

Transport-agnostic bridge core for iframe, Flutter InAppWebView, and in-memory mock runtimes. It moves JSON-safe request/response/event envelopes across an adapter while keeping host coupling outside the core.

> **Status: 0.5.6 - stable 1.0-track core.** Root, mock, iframe, flutter, and detect subpaths are shipped.

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
- `bridge.call<T>(method, payload?, { timeoutMs, signal }?)` sends a request and resolves with the remote response payload.
- `bridge.emit(event, payload?)` sends a fire-and-forget event after readiness.
- `bridge.on<T>(event, listener, { signal, once }?)` subscribes to inbound events.
- `bridge.platform()` returns `"iframe"`, `"flutter"`, `"mock"`, or `"unknown"`.
- `bridge.reset()` rejects pending calls and resubscribes to adapter messages.
- `bridge.dispose()` is idempotent permanent teardown.

## Adapters

| Subpath | Use | Notes |
| --- | --- | --- |
| `aibridgejs/mock` | Tests and local simulations | In-memory loopback; not for production traffic. |
| `aibridgejs/iframe` | `postMessage` bridges | Requires exact `targetOrigin`; `"*"` is rejected. Optional `expectedSource` adds source checking. |
| `aibridgejs/flutter` | Flutter InAppWebView | Uses `window.flutter_inappwebview.callHandler`; readiness is feature-checked. |
| `aibridgejs/detect` | Host selection | Chooses flutter/iframe/mock based on host capabilities. |

## Sharp Edges

- Payloads must be JSON-safe. The bridge does not validate cloneability or schema; validate at app boundaries.
- `call()` supports per-call `signal` and `timeoutMs`. `emit()` does not; it waits for readiness and adapter `post()`.
- `timeoutMs <= 0` disables the call timer. Pair this with an `AbortSignal` if the remote side may hang.
- `reset()` rejects all pending calls with `BridgeResetError`; listeners stay registered on the new subscription.
- iframe security depends on exact origin allowlisting. Pass `expectedSource` whenever same-origin pages share the channel.
- Flutter readiness failures are adapter-level errors; keep native handler names stable across app releases.

## AI Context

- Short index: [`llms.txt`](llms.txt)
- Full generated context: [`llms-full.txt`](llms-full.txt)
- Stability contract: [`STABILITY.md`](STABILITY.md)
- Current review backlog: [`REVIEW.md`](REVIEW.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
