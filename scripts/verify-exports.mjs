#!/usr/bin/env node
// Verify every entry declared in package.json#exports has a real file in dist/.
// Run after `pnpm build`; fails the publish if any entry is missing.

import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

const failures = [];

// Conditions may nest (e.g. import/require each carrying their own types +
// default), so walk down to every string target.
async function check(label, target) {
  if (typeof target === "string") {
    try {
      await access(resolve(root, target));
    } catch {
      failures.push(`${label} -> ${target} (missing)`);
    }
    return;
  }
  for (const [condition, child] of Object.entries(target)) {
    await check(`${label} -> ${condition}`, child);
  }
}

for (const [subpath, conditions] of Object.entries(pkg.exports)) {
  await check(subpath, conditions);
}

if (failures.length > 0) {
  console.error("verify-exports: missing files declared in package.json#exports:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`verify-exports: all ${Object.keys(pkg.exports).length} subpaths resolved.`);
