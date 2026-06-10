import { describe, expect, test, vi } from "vitest";
import { detectBridgeAdapter } from "../src/detect/index.js";

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
    expect(() => detectBridgeAdapter(host as never)).toThrow(/targetOrigin/);
  });

  test("A17d: throws when iframe is detected but targetOrigin is empty string", () => {
    const host = {
      ...fakeListener(),
      parent: { postMessage: vi.fn() },
    };
    expect(() => detectBridgeAdapter(host as never, { iframe: { targetOrigin: "" } })).toThrow();
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
});
