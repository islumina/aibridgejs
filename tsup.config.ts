import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "mock/index": "src/mock/index.ts",
    "iframe/index": "src/iframe/index.ts",
    "flutter/index": "src/flutter/index.ts",
    "detect/index": "src/detect/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  target: "es2022",
  outDir: "dist",
});
