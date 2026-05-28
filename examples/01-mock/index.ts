// Run with: pnpm example:mock
//
// Demonstrates the full createBridge + mock adapter lifecycle: ready, call,
// emit, on, and dispose. The mock adapter loops outbound messages back to
// subscribers so this runs without any host environment.

import { createBridge } from "../../src/index.js";
import { createMockAdapter } from "../../src/mock/index.js";

async function main(): Promise<void> {
  const adapter = createMockAdapter();
  const bridge = createBridge({ adapter, timeoutMs: 2000 });

  // Auto-reply to any 'request' envelope so call() resolves.
  adapter.subscribe((envelope) => {
    if (envelope.kind !== "request") return;
    queueMicrotask(() => {
      adapter.receive({
        kind: "response",
        id: envelope.id,
        ok: true,
        payload: { echo: envelope.method, args: envelope.payload },
        timestamp: Date.now(),
      });
    });
  });

  console.log("[example] awaiting ready...");
  await bridge.ready();
  console.log(`[example] platform: ${bridge.platform()}`);

  console.log("[example] calling session.getToken...");
  const result = await bridge.call("session.getToken", { scope: "game" });
  console.log("[example] response:", result);

  bridge.on("game.tick", (payload) => {
    console.log("[example] tick event:", payload);
  });

  // Simulate a host-pushed event by routing through the mock's receive.
  adapter.receive({
    kind: "event",
    event: "game.tick",
    payload: { frame: 1 },
    timestamp: Date.now(),
  });

  console.log("[example] emitting player.ready...");
  await bridge.emit("player.ready", { playerId: "p1" });

  bridge.dispose();
  console.log("[example] done.");
}

main().catch((err) => {
  console.error("[example] failed:", err);
  process.exit(1);
});
