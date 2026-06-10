#!/usr/bin/env node
// Verify gzip-compressed bundle size per subpath stays under budget.
// Run after `pnpm build`; fails the publish if any entry exceeds.
//
// CHUNK-CLOSURE SEMANTICS (wave 2026-06-10): aibridgejs builds with tsup
// `splitting: true` (cross-subpath BridgeError identity — see tsup.config.ts),
// so each entry file is a thin re-export shell importing shared `chunk-*.js`
// files. Measuring only the entry is hollow (dist/iframe/index.js reports
// ~130 B while its closure carries the adapter + core). This script mirrors
// aiecsjs/scripts/check-size.mjs: BFS over relative imports from each entry,
// sum per-file gzip sizes over the reachable set, and budget that closure.

import { gzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

// Bundles ship unminified (tsup minify is off); gzip does the work, matching
// aifsmjs. These budgets are measured against the gzipped, unminified output —
// the bytes consumers actually transfer over the wire — so an unminified build
// keeps debuggable stack traces in dist without inflating the shipped size.
// wave 2026-06-10 recalibration: budgets are CLOSURE sizes now (entry +
// shared chunks), not inlined entry sizes — the adapter entries each pull the
// shared core chunk, so their closures exceed the old inlined numbers while
// total dist JS shrank in the same splitting change. Leader-measured actuals:
// index 2,808 / mock 1,431 / iframe 1,999 / flutter 1,936 / detect 3,978 B.
const budgets = {
  "dist/index.js": 3_500,
  "dist/mock/index.js": 1_600,
  "dist/iframe/index.js": 2_200,
  "dist/flutter/index.js": 2_100,
  "dist/detect/index.js": 4_500,
};

// Relative-import regex matching both `from './foo'` and `import('./foo')`.
const IMPORT_RE = /(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function resolveChunkClosure(entryFile) {
  const visited = new Set();
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(IMPORT_RE)) {
      const rel = match[1];
      if (!rel) continue;
      const base = rel.split("?")[0].split("#")[0];
      const candidate = resolve(dirname(file), base);
      const resolved = existsSync(candidate)
        ? candidate
        : existsSync(`${candidate}.js`)
          ? `${candidate}.js`
          : null;
      if (resolved && resolved.startsWith(dist) && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return visited;
}

const failures = [];
for (const [rel, max] of Object.entries(budgets)) {
  const entryPath = resolve(root, rel);
  if (!existsSync(entryPath)) {
    failures.push(`${rel}: missing (did you run pnpm build?)`);
    continue;
  }
  const reachable = resolveChunkClosure(entryPath);
  let totalGz = 0;
  for (const file of reachable) {
    if (!existsSync(file)) continue;
    totalGz += gzipSync(readFileSync(file)).length;
  }
  const pct = ((totalGz / max) * 100).toFixed(0);
  const tag = totalGz > max ? "FAIL" : "ok  ";
  const chunkCount = reachable.size - 1;
  console.log(
    `[${tag}] ${rel.padEnd(28)} gz ${String(totalGz).padStart(6)} B / ${max} B (${pct}%)` +
      (chunkCount > 0 ? `  [+${chunkCount} chunk${chunkCount === 1 ? "" : "s"}]` : ""),
  );
  if (totalGz > max) failures.push(`${rel}: ${totalGz} B > ${max} B budget`);
}

if (failures.length > 0) {
  console.error("\ncheck-size: bundle budget exceeded:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\ncheck-size: all ${Object.keys(budgets).length} entries within budget.`);
