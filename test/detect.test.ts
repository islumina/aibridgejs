import { describe, expect, test, vi } from "vitest";
import { detectBridgeAdapter } from "../src/detect/index.js";
import { BridgeError } from "../src/errors.js";

function fakeListener(): {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
} {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe("detectBridgeAdapter", () => {
  test("A17a: detects Flutter when flutter_inappwebview.callHandler is present", () => {
    const host = {
      ...fakeListener(),
      flutter_inappwebview: { callHandler: vi.fn() },
    };
    const adapter = detectBridgeAdapter(host as never);
    expect(adapter.platform).toBe("flutter");
  });

  test("A17b: detects iframe when host has a different parent", () => {
    const host = {
      ...fakeListener(),
      parent: { postMessage: vi.fn() },
    };
    const adapter = detectBridgeAdapter(host as never, {
      iframe: { targetOrigin: "https://shell.example.com" },
    });
    expect(adapter.platform).toBe("iframe");
  });

  test("A17c: throws when iframe is detected but targetOrigin is missing", () => {
    const host = {
      ...fakeListener(),
      parent: { postMessage: vi.fn() },
    };
    expect(() => detectBridgeAdapter(host as never)).toThrow(BridgeError);
    expect(() => detectBridgeAdapter(host as never)).toThrow(
      /^aibridgejs: targetOrigin must be an exact origin/,
    );
  });

  test("A17d: throws when iframe is detected but targetOrigin is empty string", () => {
    const host = {
      ...fakeListener(),
      parent: { postMessage: vi.fn() },
    };
    expect(() => detectBridgeAdapter(host as never, { iframe: { targetOrigin: "" } })).toThrow(
      BridgeError,
    );
  });

  test("A17e: falls back to mock when no host signals are present", () => {
    const adapter = detectBridgeAdapter({} as never);
    expect(adapter.platform).toBe("mock");
  });

  test("A17f: parent === host is treated as no parent (mock fallback)", () => {
    const host = fakeListener() as ReturnType<typeof fakeListener> & { parent?: unknown };
    host.parent = host;
    const adapter = detectBridgeAdapter(host as never);
    expect(adapter.platform).toBe("mock");
  });

  test("flutter detection takes precedence over iframe parent", () => {
    const host = {
      ...fakeListener(),
      flutter_inappwebview: { callHandler: vi.fn() },
      parent: { postMessage: vi.fn() },
    };
    const adapter = detectBridgeAdapter(host as never);
    expect(adapter.platform).toBe("flutter");
  });

  test("BRG-B-01: a flutter-shaped host WITHOUT addEventListener is not selected as flutter", () => {
    // createFlutterAdapter unconditionally calls host.addEventListener (waitFor
    // ReadyEvent defaults to true). The old `as never` cast erased that hard
    // requirement from the DetectHost contract, so a host that merely exposes
    // flutter_inappwebview.callHandler but has no addEventListener would have
    // been routed to the flutter adapter and thrown an uncaught TypeError at
    // construction. The feature-check skips the flutter branch when the host
    // cannot satisfy the adapter's listener requirement → falls back to mock.
    const host = {
      flutter_inappwebview: { callHandler: vi.fn() },
      // No addEventListener / removeEventListener.
    };
    const adapter = detectBridgeAdapter(host as never);
    expect(adapter.platform).toBe("mock");
  });

  test("BRG-B-01: a flutter host WITH addEventListener is still selected (happy path intact)", () => {
    const host = {
      ...fakeListener(),
      flutter_inappwebview: { callHandler: vi.fn() },
    };
    expect(detectBridgeAdapter(host as never).platform).toBe("flutter");
  });

  test("aibridgejs-13: an iframe-shaped host WITHOUT addEventListener throws a descriptive error, not a raw TypeError", () => {
    // Mirrors BRG-B-01: createIframeAdapter unconditionally calls
    // host.addEventListener/removeEventListener, but DetectHost marks them
    // optional. Unlike the flutter branch, the iframe branch was not
    // feature-checked, so a host with a distinct `parent` but no listener
    // methods crashed inside createIframeAdapter with a raw TypeError instead
    // of a descriptive error.
    const host = {
      parent: { postMessage: vi.fn() },
      // No addEventListener / removeEventListener.
    };
    expect(() =>
      detectBridgeAdapter(host as never, { iframe: { targetOrigin: "https://a.example" } }),
    ).toThrow(BridgeError);
    expect(() =>
      detectBridgeAdapter(host as never, { iframe: { targetOrigin: "https://a.example" } }),
    ).toThrow(/^aibridgejs: host must be an object with addEventListener/);
  });

  test("a non-object options argument throws BridgeError, not a TypeError", () => {
    expect(() => detectBridgeAdapter({} as never, null as never)).toThrow(BridgeError);
    expect(() => detectBridgeAdapter({} as never, null as never)).toThrow(
      /^aibridgejs: options must be an object$/,
    );
  });

  test("aibridgejs-13: an iframe host WITH addEventListener is still selected (happy path intact)", () => {
    const host = {
      ...fakeListener(),
      parent: { postMessage: vi.fn() },
    };
    const adapter = detectBridgeAdapter(host as never, {
      iframe: { targetOrigin: "https://a.example" },
    });
    expect(adapter.platform).toBe("iframe");
  });
});
