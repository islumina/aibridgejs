import { type FlutterAdapterOptions, createFlutterAdapter } from "../flutter/index.js";
import { type IframeAdapterOptions, createIframeAdapter } from "../iframe/index.js";
import { createMockAdapter } from "../mock/index.js";
import type { BridgeAdapter } from "../types.js";

export interface DetectOptions {
  iframe?: IframeAdapterOptions;
  flutter?: FlutterAdapterOptions;
}

interface DetectHost {
  flutter_inappwebview?: { callHandler?: unknown };
  parent?: unknown;
  addEventListener?: unknown;
  removeEventListener?: unknown;
}

/**
 * Auto-detect and create the most appropriate bridge adapter.
 *
 * Pure-web safety: `pure-web safe (auto-fallback)` — falls back to mock when no shell is detected.
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 */
export function detectBridgeAdapter(host: DetectHost, options: DetectOptions = {}): BridgeAdapter {
  if (host?.flutter_inappwebview?.callHandler) {
    return createFlutterAdapter(host as never, options.flutter);
  }

  if (host?.parent && host.parent !== host) {
    if (!options.iframe || !options.iframe.targetOrigin) {
      throw new Error(
        "detectBridgeAdapter: iframe host detected but options.iframe.targetOrigin is missing",
      );
    }
    return createIframeAdapter(host as never, options.iframe);
  }

  return createMockAdapter();
}
