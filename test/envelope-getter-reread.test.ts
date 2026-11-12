import { expect, test } from "vitest";
import { createFlutterAdapter, type FlutterHost } from "../src/flutter/index.js";
import { createBridge } from "../src/index.js";
import { createMockAdapter } from "../src/mock/index.js";
import type { BridgeEnvelope } from "../src/types.js";

// isValidEnvelope() reads `kind` / `id` inside its own guard; the bridge's
// subscribe callback must not re-read them unguarded afterwards. Each getter
// below returns a valid value for the first two reads (the adapter's and the
// bridge's validation) and throws on the third.

function laterThrowingKind(kind: string, extra: Record<string, unknown>): BridgeEnvelope {
  let reads = 0;
  return {
    get kind() {
      reads++;
      if (reads > 2) throw new Error("getter boom");
      return kind;
    },
    ...extra,
    timestamp: 1,
  } as unknown as BridgeEnvelope;
}

function laterThrowingResponseId(): BridgeEnvelope {
  let reads = 0;
  return {
    kind: "response",
    ok: true,
    get id() {
      reads++;
      if (reads > 2) throw new Error("getter boom");
      return "abc";
    },
    timestamp: 1,
  } as unknown as BridgeEnvelope;
}

test("a kind getter that throws on a later read does not escape the adapter dispatch loop", () => {
  const adapter = createMockAdapter();
  const bridge = createBridge({ adapter });
  const seen: BridgeEnvelope[] = [];
  adapter.subscribe((e) => seen.push(e));
  const envelope = laterThrowingKind("event", { event: "x" });
  expect(() => adapter.receive(envelope)).not.toThrow();
  expect(seen).toHaveLength(1);
  bridge.dispose();
});

test("a response id getter that throws on a later read does not escape", () => {
  const adapter = createMockAdapter();
  const bridge = createBridge({ adapter });
  expect(() => adapter.receive(laterThrowingResponseId())).not.toThrow();
  bridge.dispose();
});

test("flutter receive(): later-throwing kind and response id getters do not escape", () => {
  const host: FlutterHost = {
    addEventListener() {},
    removeEventListener() {},
    flutter_inappwebview: { callHandler: async () => null },
  };
  const adapter = createFlutterAdapter(host, { waitForReadyEvent: false });
  const bridge = createBridge({ adapter });
  const seen: BridgeEnvelope[] = [];
  adapter.subscribe((e) => seen.push(e));
  expect(() => adapter.receive(laterThrowingKind("event", { event: "x" }))).not.toThrow();
  expect(() => adapter.receive(laterThrowingResponseId())).not.toThrow();
  expect(seen).toHaveLength(2);
  bridge.dispose();
});
