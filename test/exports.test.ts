import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// package.json#exports type resolution for TypeScript consumers. The package is
// "type": "module", so a `.d.ts` is an ESM declaration; a CJS consumer under
// node16 resolution must be routed to the `.d.cts` via the `require` condition,
// otherwise every import fails with TS1479. The fixture installs a stub copy of
// the package built from the REAL exports map (a marker declaration at every
// declared path), so this checks the map's shape without needing `pnpm build`.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  name: string;
  type: string;
  exports: Record<string, unknown>;
};

function collectTargets(node: unknown, out: string[]): void {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") {
    for (const child of Object.values(node)) collectTargets(child, out);
  }
}

function typecheck(consumerType: "commonjs" | "module"): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "aibridgejs-exports-consumer-"));
  try {
    const pkgDir = join(dir, "node_modules", pkg.name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: pkg.name, type: pkg.type, exports: pkg.exports }),
    );
    const targets: string[] = [];
    collectTargets(pkg.exports, targets);
    for (const target of targets) {
      const file = join(pkgDir, target);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        /\.d\.[cm]?ts$/.test(target) ? "export declare const marker: string;\n" : "",
      );
    }

    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: consumerType }));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "node16",
          moduleResolution: "node16",
          target: "es2022",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        files: ["index.ts"],
      }),
    );
    const subpaths = Object.keys(pkg.exports).map((key) =>
      key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`,
    );
    writeFileSync(
      join(dir, "index.ts"),
      subpaths
        .map((spec, i) => `import { marker as m${i} } from "${spec}";\nvoid m${i};`)
        .join("\n"),
    );

    try {
      const out = execFileSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8" });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("package.json exports type resolution (node16)", () => {
  test("ESM consumer (type: module) typechecks every subpath", () => {
    const r = typecheck("module");
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
  }, 30_000);

  test("CJS consumer (type: commonjs) typechecks every subpath against the .d.cts", () => {
    const r = typecheck("commonjs");
    expect(r.out).not.toContain("TS1479");
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
  }, 30_000);
});
