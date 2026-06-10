#!/usr/bin/env node
// dist-subpath smoke test (T8, ai*js wave 2026-06-10).
//
// tsup ships every subpath as its own ESM + CJS bundle (splitting:false), so a
// cross-subpath bug — e.g. duplicated module state across bundles — would let
// `BridgeError` thrown from `./iframe` fail `instanceof` the root-exported
// `BridgeError`, or break adapter ⇄ bridge interop. This verifies, for BOTH
// module systems:
//   1. Every declared subpath loads.
//   2. Root `createBridge` interoperates with the `./mock`, `./iframe`,
//      `./flutter`, and `./detect` adapters (platform wiring + a real mock
//      round-trip).
//   3. The `BridgeError` hierarchy is shared across subpaths: an error thrown
//      from a subpath is `instanceof` the ROOT export (same-realm registry).
// Any throw / failed assertion → exit(1). Success → print SHARED-OK per system.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Minimal host stubs so the iframe / flutter adapters construct under Node
// (no window). They only need the listener surface each adapter touches.
function makeIframeHost() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}
function makeFlutterHost() {
  return {
    flutter_inappwebview: { callHandler: async () => null },
    addEventListener() {},
    removeEventListener() {},
  };
}

// Exercise the loaded module set (shared shape for ESM and CJS).
async function exercise(label, mods) {
  const { createBridge, BridgeError, BridgeDisposedError } = mods.root;
  const { createMockAdapter } = mods.mock;
  const { createIframeAdapter } = mods.iframe;
  const { createFlutterAdapter } = mods.flutter;
  const { detectBridgeAdapter } = mods.detect;

  // (1) Root × ./mock — real loopback round-trip (auto-reply to the request).
  const mock = createMockAdapter();
  mock.subscribe((env) => {
    if (env.kind !== "request") return;
    mock.receive({
      kind: "response",
      id: env.id,
      ok: true,
      payload: { echo: env.method },
      timestamp: Date.now(),
    });
  });
  const bridge = createBridge({ adapter: mock });
  await bridge.ready();
  const res = await bridge.call("ping");
  assert(
    res && typeof res === "object" && res.echo === "ping",
    `${label}: mock round-trip returned ${JSON.stringify(res)}`,
  );
  assert(bridge.platform() === "mock", `${label}: expected mock platform`);
  bridge.dispose();

  // (2) Root × ./iframe — platform wiring through the bridge.
  const iframeBridge = createBridge({
    adapter: createIframeAdapter(makeIframeHost(), {
      targetOrigin: "https://shell.example.com",
    }),
  });
  assert(iframeBridge.platform() === "iframe", `${label}: expected iframe platform`);
  iframeBridge.dispose();

  // (3) Root × ./flutter — platform wiring through the bridge.
  const flutterBridge = createBridge({
    adapter: createFlutterAdapter(makeFlutterHost(), { waitForReadyEvent: false }),
  });
  assert(flutterBridge.platform() === "flutter", `${label}: expected flutter platform`);
  flutterBridge.dispose();

  // (4) Root × ./detect — empty host falls back to a mock adapter.
  const detected = detectBridgeAdapter({});
  assert(detected.platform === "mock", `${label}: detect fallback expected mock`);
  const detectBridge = createBridge({ adapter: detected });
  assert(detectBridge.platform() === "mock", `${label}: detect bridge expected mock`);
  detectBridge.dispose();

  // (5a) Cross-subpath identity: a BridgeError thrown from ./iframe (invalid
  // targetOrigin, BRG-S-03) is instanceof the ROOT BridgeError. If the iframe
  // bundle carried its own copy of the error class, this would be false.
  let iframeErr;
  try {
    createIframeAdapter(makeIframeHost(), { targetOrigin: "https://shell.example.com/" });
  } catch (e) {
    iframeErr = e;
  }
  assert(iframeErr instanceof BridgeError, `${label}: iframe error not instanceof root BridgeError`);

  // (5b) Cross-subpath identity: BridgeDisposedError raised by the root bridge
  // around a ./flutter adapter is instanceof both its own class and the root
  // base BridgeError.
  const disposedBridge = createBridge({
    adapter: createFlutterAdapter(makeFlutterHost(), { waitForReadyEvent: false }),
  });
  disposedBridge.dispose();
  let disposedErr;
  try {
    disposedBridge.platform();
  } catch (e) {
    disposedErr = e;
  }
  assert(
    disposedErr instanceof BridgeDisposedError && disposedErr instanceof BridgeError,
    `${label}: disposed error not instanceof root BridgeDisposedError/BridgeError`,
  );

  process.stdout.write(`${label}: SHARED-OK\n`);
}

async function smokeESM() {
  const [rootMod, mock, iframe, flutter, detect] = await Promise.all([
    import(resolve(root, "dist/index.js")),
    import(resolve(root, "dist/mock/index.js")),
    import(resolve(root, "dist/iframe/index.js")),
    import(resolve(root, "dist/flutter/index.js")),
    import(resolve(root, "dist/detect/index.js")),
  ]);
  await exercise("ESM", { root: rootMod, mock, iframe, flutter, detect });
}

async function smokeCJS() {
  const mods = {
    root: require(resolve(root, "dist/index.cjs")),
    mock: require(resolve(root, "dist/mock/index.cjs")),
    iframe: require(resolve(root, "dist/iframe/index.cjs")),
    flutter: require(resolve(root, "dist/flutter/index.cjs")),
    detect: require(resolve(root, "dist/detect/index.cjs")),
  };
  await exercise("CJS", mods);
}

try {
  await smokeESM();
  await smokeCJS();
} catch (err) {
  process.stderr.write(
    `check-dist-subpaths FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
}
