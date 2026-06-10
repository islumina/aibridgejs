import {
  type FlutterAdapterOptions,
  type FlutterHost,
  createFlutterAdapter,
} from "../flutter/index.js";
import { type IframeAdapterOptions, createIframeAdapter } from "../iframe/index.js";
import { createMockAdapter } from "../mock/index.js";
import type { BridgeAdapter } from "../types.js";

export interface DetectOptions {
  iframe?: IframeAdapterOptions;
  flutter?: FlutterAdapterOptions;
}

type ListenerFn = (...args: never[]) => void;

interface DetectHost {
  flutter_inappwebview?: { callHandler?: unknown };
  parent?: unknown;
  // Optional because a pure-web / SSR-shim host may lack them (it then falls
  // back to mock). When the Flutter branch is taken these MUST be callable —
  // createFlutterAdapter registers a platform-ready listener unconditionally —
  // so the branch is guarded by a runtime feature-check below (BRG-B-01).
  addEventListener?: ListenerFn;
  removeEventListener?: ListenerFn;
}

/**
 * Auto-detect and create the most appropriate bridge adapter.
 *
 * Pure-web safety: `pure-web safe (auto-fallback)` — falls back to mock when no shell is detected.
 *
 * See [STABILITY.md](../STABILITY.md) for the full per-subpath safety table.
 */
export function detectBridgeAdapter(host: DetectHost, options: DetectOptions = {}): BridgeAdapter {
  // Feature-check, not just a shape probe: createFlutterAdapter registers a
  // platform-ready listener via host.addEventListener and detaches it in
  // dispose() via host.removeEventListener (waitForReadyEvent defaults to
  // true). A host that exposes flutter_inappwebview.callHandler but lacks
  // callable listener methods would raise an uncaught TypeError at adapter
  // construction. Require both methods before taking the Flutter branch; a
  // host that fails the check falls through to the iframe / mock checks below
  // rather than crashing (BRG-B-01).
  if (
    host?.flutter_inappwebview?.callHandler &&
    typeof host.addEventListener === "function" &&
    typeof host.removeEventListener === "function"
  ) {
    return createFlutterAdapter(host as FlutterHost, options.flutter);
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
