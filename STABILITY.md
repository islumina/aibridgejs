# Stability Contract

[English](STABILITY.md) | [繁體中文](STABILITY_ZHTW.md)

This document is the per-export stability promise for `aibridgejs`, and the per-subpath safety promise for callers running in pure-web environments (no iframe parent, no native shell).

## Policy

aibridgejs follows [semver](https://semver.org/). Within the **0.x** series:
- **`stable`** exports do not change in breaking ways across minor versions (e.g. 0.2 → 0.3).
- **`experimental`** exports may change shape, name, or behaviour in any minor release. Pin the exact version if you depend on them.
- **`internal`** is not part of the API. May change in any patch release. Do not import.

At **1.0**, the `stable` surface freezes for the entire 1.x series.

## Pure-web safety

Each subpath carries a **pure-web safety** tag describing what happens when you import it in a browser tab that has **no `window.parent` shell and no `window.flutter_inappwebview` handler** — i.e. the v0.5+ web game scenario where the page is loaded directly, not embedded in iframe or Flutter InAppWebView.

| Tag | Meaning |
|---|---|
| `pure-web safe` | Works correctly in a pure-web page. No native shell required. |
| `pure-web safe (auto-fallback)` | Works correctly; the entrypoint auto-detects the absence of a shell and falls back to a mock adapter. |
| `requires native shell` | Throws or hangs in a pure-web page. Only use when you actually have the shell (Flutter InAppWebView, etc.). |
| `dev only` | Functions correctly but is not intended for production traffic. |

## By subpath

### `aibridgejs` (root)

| Export | Stability | Pure-web safety | Since | Notes |
|---|---|---|---|---|
| `createBridge` | stable | pure-web safe | 0.1.0 | Environment dependency is delegated to the supplied adapter. |
| `Bridge` (type) | stable | — | 0.1.0 | |
| `BridgeAdapter` (type) | stable | — | 0.1.0 | Adapter contract; implement to add a new transport. |
| `BridgeEnvelope` (type) | stable | — | 0.1.0 | Discriminated union: request / response / event. |
| `BridgePlatform` (type) | stable | — | 0.1.3 | `"iframe" \| "flutter" \| "mock" \| "unknown"`. The pre-0.1.3 `"cocos"` literal was removed in 0.1.3 — no adapter shipped it. |
| `BridgeOptions` (type) | stable | — | 0.1.0 | |
| `BridgeListener`, `CallOptions`, `OnOptions`, `ReadyOptions` (types) | stable | — | 0.1.0 | |
| `EventEnvelope`, `RequestEnvelope`, `ResponseEnvelope`, `SubscribeMeta` (types) | stable | — | 0.1.0 | |
| `BridgeError`, `BridgeDisposedError`, `BridgeResetError`, `BridgeTimeoutError`, `BridgeRemoteError` | stable | — | 0.1.0 | Five-class hierarchy. `error.name` discriminates. |

### `aibridgejs/mock`

| Export | Stability | Pure-web safety | Since | Notes |
|---|---|---|---|---|
| `createMockAdapter` | stable | dev only | 0.1.0 | In-memory loopback. Outbound messages are echoed synchronously to subscribers. Not for production traffic. |
| `MockAdapter` (type) | stable | — | 0.1.0 | |

### `aibridgejs/iframe`

| Export | Stability | Pure-web safety | Since | Notes |
|---|---|---|---|---|
| `createIframeAdapter` | stable | pure-web safe | 0.1.0 | Requires an exact `targetOrigin`; wildcard `*` is rejected at construction. Both `event.origin` and `event.source` are validated on every inbound message. |
| `IframeAdapter`, `IframeAdapterOptions`, `IframeHost`, `IframePostTarget`, `MessageEventLike` (types) | stable | — | 0.1.0 | |

### `aibridgejs/flutter`

| Export | Stability | Pure-web safety | Since | Notes |
|---|---|---|---|---|
| `createFlutterAdapter` | stable | requires native shell | 0.1.0 | Requires `host.flutter_inappwebview.callHandler`. Not present in a pure-web page; `post()` throws and `ready()` hangs until the platform-ready DOM event fires. |
| `FlutterAdapter`, `FlutterAdapterOptions`, `FlutterHost`, `FlutterInAppWebView` (types) | stable | — | 0.1.0 | |

### `aibridgejs/detect`

| Export | Stability | Pure-web safety | Since | Notes |
|---|---|---|---|---|
| `detectBridgeAdapter` | stable | pure-web safe (auto-fallback) | 0.1.0 | Detection order: `flutter_inappwebview` → `parent !== self` → mock. Pure-web pages land on mock with no extra config. iframe detection requires `options.iframe.targetOrigin` to be supplied. |
| `DetectOptions` (type) | stable | — | 0.1.0 | |

## Roadmap

| Version | Focus | Stability shift |
|---|---|---|
| 0.1.x | Core surface + four adapters | Initial publish. |
| 0.2.x | Correctness + ergonomics | `reset()` settles slow-ready waiters; `Bridge.call` generic; `verify:llms` gate. See [CHANGELOG.md](./CHANGELOG.md#020---2026-05-28). |
| 0.3.0 | Stability contract + pure-web safety labels | This release. No runtime change. |
| 0.4+ | Hardening + adapter ergonomics | TBD. |
| 1.0.0 | API freeze | All `stable` exports frozen for 1.x. |

## Future (design notes only)

The two items below are **not implemented** in 0.3.x and have no committed timeline. They are recorded here so consumers know the shape of likely future work.

### [experimental] Binary envelope (v0.7+ target)

Status: design notes only. Not implemented.

Problem: `BridgeEnvelope.payload` is JSON-only. Sending a `Uint8Array` (e.g. compressed PRNG state for save-game sync) currently requires base64 round-tripping at every boundary, costing ~33% size overhead and double serialization.

Likely shape: a new `binary-request` / `binary-response` envelope kind carrying `payload: Uint8Array` next to JSON-serialisable `meta`. Open trade-offs: `postMessage` supports Transferable (zero-copy `ArrayBuffer`) but `flutter_inappwebview.callHandler` does not — adapter asymmetry. `generateId()` `Math.random` fallback would need to be promoted to `crypto.randomUUID()` strict mode if binary payloads carry PRNG seeds across a trust boundary.

### [experimental] Long-lived streaming RPC (v0.7+ target)

Status: placeholder only. Not designed.

Problem: `call()` is strict 1-request-1-response. Server-sent style multi-segment responses (e.g. paginated leaderboard push) need a different envelope shape.

Likely shape: `stream()` returning `AsyncIterable<T>`; new `stream-chunk` / `stream-end` envelope kinds.

## How to check at runtime

```ts
import { createBridge } from 'aibridgejs'
// no runtime VERSION export — pin via package.json
```

For programmatic introspection of stability, parse this file's `By subpath` tables.
