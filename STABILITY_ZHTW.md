# 穩定度合約

[English](STABILITY.md) | [繁體中文](STABILITY_ZHTW.md)

本檔案是 `aibridgejs` **逐 export 的穩定度承諾**，以及**逐 subpath 在純 web 環境（無 iframe parent、無 native shell）下的安全性承諾**。

## 政策

aibridgejs 遵循 [semver](https://semver.org/)。在 **0.x** 系列內：
- **`stable`** 的 export 在跨 minor 版本（如 0.2 → 0.3）時不會有破壞性變更。
- **`experimental`** 的 export 在任何 minor 版本都可能變更形狀、名稱或行為。若有依賴請鎖定精確版本。
- **`internal`** 不屬於 API，可能在任何 patch 版本變更。請勿 import。

到 **1.0** 版時，`stable` 表面在整個 1.x 系列中凍結。

**自 0.4.0 起**，下列整個 `stable` 表面已納入 1.0-track 承諾：在 1.0 之前僅接受 additive 變更（新增可選 export、新增可選參數、擴增 error message），並視為在正式 1.0 凍結前即已凍結。兩項 `experimental` 設計筆記（二進位封包、streaming RPC）明確**排除**，仍可能變更——目標版本不早於 v0.7。

## Pure-web safety

每個 subpath 都帶有一個 **pure-web safety** 標籤，描述在**沒有 `window.parent` shell 且沒有 `window.flutter_inappwebview` handler** 的瀏覽器分頁中 import 時的行為——即 v0.5+ 網頁遊戲情境，頁面直接載入而非嵌入 iframe 或 Flutter InAppWebView。

| 標籤 | 含義 |
|---|---|
| `純 web 安全` | 在純 web 頁面中可正常運作，不需要原生 shell。 |
| `純 web 安全（自動 fallback）` | 可正常運作；進入點會自動偵測 shell 不存在並 fallback 至 mock 適配器。 |
| `需要原生 shell` | 在純 web 頁面中會拋出例外或懸掛。僅在確實擁有 shell（Flutter InAppWebView 等）時使用。 |
| `僅供開發` | 功能正常，但不適用於正式流量。 |

## 逐 subpath

### `aibridgejs`（根路徑）

| Export | 穩定度 | Pure-web safety | 自版本 | 備註 |
|---|---|---|---|---|
| `createBridge` | stable | 純 web 安全 | 0.1.0 | 環境依賴委託給所提供的適配器。 |
| `Bridge`（型別） | stable | — | 0.1.0 | |
| `BridgeAdapter`（型別） | stable | — | 0.1.0 | 適配器合約；實作以新增傳輸層。 |
| `BridgeEnvelope`（型別） | stable | — | 0.1.0 | 判別聯合：request / response / event。 |
| `BridgePlatform`（型別） | stable | — | 0.1.3 | `"iframe" \| "flutter" \| "mock" \| "unknown"`。0.1.3 前的 `"cocos"` 字面值已於 0.1.3 移除——沒有任何適配器曾使用它。 |
| `BridgeOptions`（型別） | stable | — | 0.1.0 | |
| `BridgeListener`、`CallOptions`、`OnOptions`、`ReadyOptions`（型別） | stable | — | 0.1.0 | |
| `EventEnvelope`、`RequestEnvelope`、`ResponseEnvelope`、`SubscribeMeta`（型別） | stable | — | 0.1.0 | |
| `BridgeError`、`BridgeDisposedError`、`BridgeResetError`、`BridgeTimeoutError`、`BridgeRemoteError` | stable | — | 0.1.0 | 五類繼承體系，以 `error.name` 判別。 |

### `aibridgejs/mock`

| Export | 穩定度 | Pure-web safety | 自版本 | 備註 |
|---|---|---|---|---|
| `createMockAdapter` | stable | 僅供開發 | 0.1.0 | 記憶體內回環，出站訊息同步回應給訂閱者。不適用於正式流量。 |
| `MockAdapter`（型別） | stable | — | 0.1.0 | |

### `aibridgejs/iframe`

| Export | 穩定度 | Pure-web safety | 自版本 | 備註 |
|---|---|---|---|---|
| `createIframeAdapter` | stable | 純 web 安全 | 0.1.0 | 需要精確的 `targetOrigin`；萬用字元 `*` 在建構時即被拒絕。`event.origin` 一律驗證；`event.source` 預設會比對預期 frame，除非以 `expectedSource: null` 顯式關閉 source 檢查。 |
| `IframeAdapter`、`IframeAdapterOptions`、`IframeHost`、`IframePostTarget`、`MessageEventLike`（型別） | stable | — | 0.1.0 | |

### `aibridgejs/flutter`

| Export | 穩定度 | Pure-web safety | 自版本 | 備註 |
|---|---|---|---|---|
| `createFlutterAdapter` | stable | 需要原生 shell | 0.1.0 | 需要 `host.flutter_inappwebview.callHandler`。在純 web 頁面中不存在；`post()` 會拋出例外，`ready()` 會懸掛直到平台就緒 DOM 事件觸發。 |
| `FlutterAdapter`、`FlutterAdapterOptions`、`FlutterHost`、`FlutterInAppWebView`（型別） | stable | — | 0.1.0 | |

### `aibridgejs/detect`

| Export | 穩定度 | Pure-web safety | 自版本 | 備註 |
|---|---|---|---|---|
| `detectBridgeAdapter` | stable | 純 web 安全（自動 fallback） | 0.1.0 | 偵測順序：`flutter_inappwebview` → `parent !== self` → mock。純 web 頁面無需額外設定即落入 mock。iframe 偵測需提供 `options.iframe.targetOrigin`。 |
| `DetectOptions`（型別） | stable | — | 0.1.0 | |

## 開發藍圖

| 版本 | 重點 | 穩定度變更 |
|---|---|---|
| 0.1.x | 核心表面 + 四個適配器 | 初次發佈。 |
| 0.2.x | 正確性 + 人體工學 | `reset()` 解決慢速就緒等待者；`Bridge.call` 泛型化；`verify:llms` 閘控。詳見 [CHANGELOG.md](./CHANGELOG.md#020---2026-05-28)。 |
| 0.3.0 | 穩定度合約 + 純 web 安全標籤 | 無執行期變更。 |
| 0.4.0 | 依賴清理 + 1.0-track 穩定度凍結 | 本次發佈。無執行期變更；`stable` 表面納入 1.0-track 承諾（僅 additive）。已驗證零 runtime dep、devDep 家族對齊、零 audit advisory。 |
| 1.0.0 | API 凍結 | 所有 `stable` export 在 1.x 凍結。 |

## 未來規劃（僅設計筆記）

以下兩項在 0.3.x 中**尚未實作**，也沒有承諾的時程。記錄於此，讓使用者了解未來可能的工作方向。

### [experimental] 二進位封包（v0.7+ 目標）

狀態：僅設計筆記。尚未實作。

問題：`BridgeEnvelope.payload` 僅支援 JSON。傳送 `Uint8Array`（例如用於存檔同步的壓縮 PRNG 狀態）目前需要在每個邊界做 base64 往返轉換，帶來約 33% 的大小額外負擔與雙重序列化。

可能形狀：新的 `binary-request` / `binary-response` 封包種類，在 JSON 可序列化的 `meta` 旁攜帶 `payload: Uint8Array`。尚待解決的取捨：`postMessage` 支援 Transferable（零拷貝 `ArrayBuffer`），但 `flutter_inappwebview.callHandler` 不支援——適配器不對稱。若二進位 payload 跨信任邊界攜帶 PRNG 種子，`generateId()` 的 `Math.random` fallback 需提升至嚴格模式 `crypto.randomUUID()`。

### [experimental] 長存 streaming RPC（v0.7+ 目標）

狀態：僅佔位，尚未設計。

問題：`call()` 是嚴格的一請求一回應。伺服器推送式多段回應（例如分頁排行榜推播）需要不同的封包形狀。

可能形狀：回傳 `AsyncIterable<T>` 的 `stream()`；新的 `stream-chunk` / `stream-end` 封包種類。

## 如何在執行期確認

```ts
import { createBridge } from 'aibridgejs'
// 無執行期 VERSION export——請透過 package.json 鎖定版本
```

若要以程式方式內省穩定度，請解析本檔案「逐 subpath」各節的表格。
