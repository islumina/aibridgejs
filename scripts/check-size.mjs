#!/usr/bin/env node
// Verify gzip-compressed bundle size per subpath stays under budget.
// Run after `pnpm build`; fails the publish if any entry exceeds.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Bundles ship unminified (tsup minify is off); gzip does the work, matching
// aifsmjs. These budgets are measured against the gzipped, unminified output —
// the bytes consumers actually transfer over the wire — so an unminified build
// keeps debuggable stack traces in dist without inflating the shipped size.
const budgets = {
  "dist/index.js": 3500,
  "dist/mock/index.js": 1000,
  "dist/iframe/index.js": 1500,
  "dist/flutter/index.js": 1500,
  "dist/detect/index.js": 4500,
};

const failures = [];
for (const [rel, max] of Object.entries(budgets)) {
  const abs = resolve(root, rel);
  let buf;
  try {
    buf = await readFile(abs);
  } catch {
    failures.push(`${rel}: missing (did you run pnpm build?)`);
    continue;
  }
  const gz = gzipSync(buf).length;
  const pct = ((gz / max) * 100).toFixed(0);
  const tag = gz > max ? "FAIL" : "ok  ";
  console.log(`[${tag}] ${rel.padEnd(28)} gz ${String(gz).padStart(5)} B / ${max} B (${pct}%)`);
  if (gz > max) failures.push(`${rel}: ${gz} B > ${max} B budget`);
}

if (failures.length > 0) {
  console.error("\ncheck-size: bundle budget exceeded:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\ncheck-size: all ${Object.keys(budgets).length} entries within budget.`);
