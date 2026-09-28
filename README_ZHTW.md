# aibridgejs

跨 iframe、Flutter InAppWebView、mock runtime 的 transport-agnostic bridge core。它只處理 JSON-safe request / response / event envelope，host 耦合留在 adapter。

> **狀態：0.5.9 - 穩定 1.0 軌道核心。** 已發布 root、mock、iframe、flutter、detect subpaths。

## 安裝

```bash
pnpm add aibridgejs
```

```ts
import { createBridge } from "aibridgejs";
import { createIframeAdapter } from "aibridgejs/iframe";
```

## 快速開始

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

## 核心 API

- `createBridge({ adapter, timeoutMs? })` 用單一 adapter 建立 bridge。
- `bridge.ready({ signal }?)` 等待 adapter ready。
- `bridge.call<T>(method, payload?, { timeoutMs, signal }?)` 發送 request 並解析 remote response payload。
- `bridge.emit(event, payload?, { signal, timeoutMs }?)` 在 ready 後送出 fire-and-forget event；選用的 `signal` / `timeoutMs` 可取消或限制單次 emit 的時間。
- `bridge.on<T>(event, listener, { signal, once }?)` 訂閱 inbound event。
- `bridge.platform()` 回傳 `"iframe"`、`"flutter"`、`"mock"` 或 `"unknown"`。
- `bridge.reset()` 拒絕 pending calls 並重建 adapter subscription。
- `bridge.dispose()` 是可重複呼叫的永久 teardown。

## Adapters

| Subpath | 用途 | 注意 |
| --- | --- | --- |
| `aibridgejs/mock` | 測試與本地模擬 | in-memory loopback；不適合 production traffic。 |
| `aibridgejs/iframe` | `postMessage` bridge | 必須使用精確 `targetOrigin`；拒絕 `"*"`。`expectedSource` 可加上 source check。 |
| `aibridgejs/flutter` | Flutter InAppWebView | 使用 `window.flutter_inappwebview.callHandler`；ready 會做 feature check。 |
| `aibridgejs/detect` | host selection | 依 host capability 選 flutter / iframe / mock。 |

## 注意事項

- Payload 必須 JSON-safe。bridge 不驗證 cloneability 或 schema；請在 app 邊界驗證。
- `call()` 與 `emit()` 都支援單次 `signal` 與 `timeoutMs`。`emit()` 的選項是 opt-in：省略時維持 fire-and-forget（等待 ready 與 adapter `post()`，無時間限制）。
- `timeoutMs <= 0` 會關閉 call timer。若 remote 可能 hang，請搭配 `AbortSignal`。
- `reset()` 會用 `BridgeResetError` 拒絕所有 pending calls；listener 會保留並套到新 subscription。
- iframe 安全性依賴精確 origin allowlist。若同 origin 有多個頁面共用通道，請傳入 `expectedSource`。
- Flutter readiness error 屬於 adapter-level；native handler 名稱要跟 app release 一起穩定管理。
- Event listener 拋出的錯誤會被隔離並丟棄，這是設計上的行為——單一異常的 listener 不會中斷其他 sibling 的 fan-out。若需要觀察錯誤，請自行在 handler 內包 `try/catch`。
- `dispose()` 之後，`ready()`、`platform()`、`on()`、`reset()` 會同步 throw `BridgeDisposedError`，而不是 reject——這點跟會 reject 的 `call()` / `emit()` 不同。若程式碼假設 `bridge.ready().then(...).catch(...)`，bridge 已經 dispose 時會直接讓呼叫端 crash。

## AI Context

- 短索引：[`llms.txt`](llms.txt)
- 完整生成內容：[`llms-full.txt`](llms-full.txt)
- 穩定度契約：[`STABILITY.md`](STABILITY.md)
- 目前 review backlog：[`REVIEW.md`](REVIEW.md)
- 版本紀錄：[`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
