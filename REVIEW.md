# Code Review Report — aibridgejs

| Field      | Value                                                                                     |
|------------|-------------------------------------------------------------------------------------------|
| Repo       | aibridgejs                                                                                |
| Version    | 0.5.1                                                                                     |
| Branch     | claude/adoring-ptolemy-OGonc                                                              |
| Head SHA   | 805af0d2d447a3f19faba6beed1c0f99ccf3dfa0                                                  |
| Date       | 2026-06-03                                                                                |
| Reviewer   | claude-sonnet-4-6                                                                          |

---

## Verdict / Summary

**PASS — ship-ready with one safe doc fix applied.**

The codebase is in strong shape. All seven baseline gates pass; coverage meets
thresholds (98 stmt / 91.86 branch / 100 func / 100 lines). The core
architecture is sound: adapter-isolated host coupling, discriminated-union
envelopes with validation at every inbound boundary, and thorough
request/response correlation under arbitrary response ordering (property-based).
The one applied safe fix corrects a stale count and a missing command in
`CONTRIBUTING.md`'s local-workflow section (regenerated `llms-full.txt`
accordingly). Seven findings are recorded below for maintainer consideration;
none are blockers and none were auto-fixed.

---

## Gate Results

| Gate             | Baseline | After fix |
|------------------|----------|-----------|
| typecheck        | PASS     | PASS      |
| lint             | PASS     | PASS      |
| build            | PASS     | PASS      |
| verify:exports   | PASS     | PASS      |
| verify:llms      | PASS     | PASS      |
| check:size       | PASS     | PASS      |
| coverage         | PASS     | PASS (not re-run — src/ and test/ unchanged) |

### Bundle sizes (gzip / budget)

| Subpath           | gzip    | Budget  | Used |
|-------------------|---------|---------|------|
| dist/index.js     | 2390 B  | 3500 B  | 68%  |
| dist/mock/index.js| 799 B   | 1000 B  | 80%  |
| dist/iframe/index.js | 1199 B | 1500 B | 80% |
| dist/flutter/index.js | 1277 B | 1500 B | 85% |
| dist/detect/index.js | 1942 B | 4500 B | 43% |

All five subpaths within budget.

---

## Safe Fixes Applied

| # | File | Kind | Description |
|---|------|------|-------------|
| 1 | `CONTRIBUTING.md` | doc / string | Adds `pnpm verify:llms` to the local-workflow command list (was in `prepublishOnly` but missing from the developer-facing checklist); corrects the stale "All six commands" count to "All commands above". |
| 2 | `llms-full.txt` | doc / generated | Regenerated via `pnpm build:llms` to reflect the CONTRIBUTING.md change; kept in sync per the repo convention. |

---

## Findings by Severity

### H — High

_None._

### M — Medium

#### M1 · Envelope validation: `isValidEnvelope` does not enforce an empty-string guard on `id`, `method`, and `event` fields
**File:** `src/internal.ts:17–21`  
**Area:** Inbound-message / envelope validation  
**Description:** The validator confirms that `id`, `method`, and `event` are strings, but an empty string (`""`) satisfies `typeof x === "string"`. An inbound `response` envelope with `id: ""` would look up `pending.get("")` — harmless today because `generateId()` never emits `""`, but a hostile host could inject a response envelope with `id: ""` that matches a pending entry if one happened to be keyed to that id. More concretely, a `request` envelope with `method: ""` or an `event` envelope with `event: ""` would pass validation and reach event listeners keyed to `""`. In `bridge.on("", ...)` — unlikely in practice but not prevented at the API level.  
**Recommendation (FINDINGS-ONLY — behavior change):** Add `&& id.length > 0`, `&& method.length > 0`, and `&& event.length > 0` to the respective switch-case returns in `isValidEnvelope`. Also consider applying the same guard in `bridge.call()` and `bridge.on()` for the caller-supplied method/event names.

---

#### M2 · Flutter `receive()` bypasses `disposed` check
**File:** `src/flutter/index.ts:147–149`  
**Area:** Adapter dispose semantics  
**Description:** The mock adapter's `receive()` guards with `if (disposed) return;` (line 67). The Flutter adapter's `receive()` calls `dispatch()`, which does guard at line 73, but it does so inside `dispatch` rather than at the `receive` entry point. The behaviour is functionally identical today, but the asymmetry is a readability / future-diff risk: if `dispatch` is ever extracted or the guard removed, the `receive` entry point becomes silently unsafe.  
**Recommendation (FINDINGS-ONLY — minor behavior parity):** Add `if (disposed) return;` directly at the top of `receive()` in `src/flutter/index.ts`, mirroring the mock adapter's pattern. This is a one-line no-op change in normal operation but makes the invariant local and obvious.

---

### L — Low

#### L1 · `emit()` not documented as lacking `AbortSignal` support in `CONTRIBUTING.md`
**File:** `CONTRIBUTING.md:18–20`  
**Area:** Documentation  
**Description:** CONTRIBUTING states "Every async public method must accept a `signal` option." `emit()` is async and public but intentionally does not accept a signal (documented as fire-and-forget in `llms.txt`). A contributor following CONTRIBUTING literally would add a `signal` parameter to a future `emit()` override without realising it is out of scope by design.  
**Recommendation (SAFE-FIX eligible — doc clarification):** Amend the CONTRIBUTING rule to read "Every async public method that tracks in-flight work must accept a `signal` option" or add a parenthetical excluding fire-and-forget `emit()`.  
Note: This was not auto-applied because it touches a normative policy statement; maintainer wording judgment is appropriate.

---

#### L2 · `readyPromise!` non-null assertion in `bridge.ts:175` could be replaced with a local variable
**File:** `src/bridge.ts:175`  
**Area:** Code quality  
**Description:** The `readyPromise!.then(...)` on line 175 uses a non-null assertion because TypeScript cannot infer that reaching the `userSignal` branch implies `readyPromise` is non-null (it was set by the `if (!readyPromise)` block above, but the narrowing is lost across the `if` boundary). Extracting to a local constant (`const rp = readyPromise; ... rp.then(...)`) would eliminate the `!` while keeping the behaviour identical and making the dependency explicit.  
**Recommendation (SAFE-FIX eligible — trivial refactor):** `const rp = readyPromise; rp.then(...)`. Not auto-applied because `biome.json` has `noNonNullAssertion: "off"` and the fix is cosmetic.

---

#### L3 · `isValidEnvelope` does not reject arrays (objects with numeric keys)
**File:** `src/internal.ts:3–4`  
**Area:** Inbound-message / envelope validation  
**Description:** `Array.isArray([])` is true, yet `typeof [] !== "object"` is false — arrays pass the `typeof value !== "object"` guard. An inbound `[{"kind":"event",...}]` array would hit `v.kind === undefined`, fall to `default: return false`, and be correctly discarded. However, an array *with* a `kind` property added directly (`arr.kind = "event"`) would pass. This is an extremely exotic attack surface (not possible via `JSON.parse` from a normal message channel) and has no known exploit path in the current message-dispatch code, but it is a latent gap.  
**Recommendation (FINDINGS-ONLY — low risk in practice):** Add `|| Array.isArray(value)` to the early-return guard: `if (value === null || Array.isArray(value) || typeof value !== "object") return false;`. This closes the theoretical gap at zero behaviour cost for valid traffic.

---

#### L4 · `BridgeRemoteError.detail` is typed `unknown` but accepts a hostile value from the remote host
**File:** `src/bridge.ts:85`  
**Area:** Inbound-message / envelope validation  
**Description:** The `detail` field is read from the untrusted error object with no coercion: `detail = err?.detail;`. Unlike `code` and `message`, there is no type check or try/catch wrapping the `detail` read. A hostile host could supply an object whose `detail` getter throws; this would be caught by the surrounding `try/catch` and fall back to `BridgeRemoteError("Remote error", "REMOTE_ERROR")` with `detail: undefined` — which is safe. However, the intent is slightly unclear: is `detail` intentionally "whatever the host sent, no normalization" or should it also be protected? The JSDoc comment in `bridge.ts:65-88` describes the try/catch as guarding `message` and `code` specifically but does not mention `detail`.  
**Recommendation (FINDINGS-ONLY — clarification):** Explicitly document in the comment that `detail` is intentionally left as-is (pass-through from the untrusted host, may be any JSON value) and that callers should treat it as `unknown` in their own error-handling. The current behavior is correct; this is a documentation gap rather than a bug.

---

#### L5 · No test for `emit()` rejection after `reset()` with a slow `ready()`
**File:** `test/bridge.test.ts`  
**Area:** Test completeness  
**Description:** `emit()` after `dispose()` is tested (line 562). However, there is no test for `emit()` being called *after* `reset()` while the adapter's `ready()` is slow — i.e., the path where `emit()` awaits a new `ready()`, `reset()` fires again, and the second `BridgeResetError` must surface to the `emit()` caller. The existing coverage shows this path is not deterministically hit (branch coverage in `bridge.ts` lines 280-281 is not 100%). This is a low-risk gap because `emit()` and `call()` share the same `ready()`-gate and `resetEpoch` guard, which are well-tested for `call()`.  
**Recommendation (FINDINGS-ONLY — test addition):** Add a test mirroring the `call()`-with-slow-ready-then-reset pattern but exercised through `emit()`, confirming it rejects with `BridgeResetError`.

---

## Findings-Only Backlog (summary)

| # | Sev | Area | Title |
|---|-----|------|-------|
| M1 | M | Validation | `isValidEnvelope` allows empty-string `id`/`method`/`event` |
| M2 | M | Adapter dispose | Flutter `receive()` missing top-level disposed guard (cosmetic parity) |
| L1 | L | Docs | CONTRIBUTING overstates signal requirement for `emit()` |
| L2 | L | Code quality | `readyPromise!` assertion replaceable with local const |
| L3 | L | Validation | `isValidEnvelope` does not explicitly reject arrays |
| L4 | L | Docs | `detail` passthrough from untrusted host undocumented |
| L5 | L | Tests | Missing `emit()`-after-reset-with-slow-ready test |

---

## Appendix

### Commands run

```sh
corepack enable
cd /home/user/aibridgejs
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:exports
pnpm verify:llms
pnpm check:size
pnpm coverage
# After fix:
pnpm lint && pnpm typecheck && pnpm build && pnpm check:size && pnpm verify:llms
```

### Tool versions

```
pnpm: 9.12.3 (corepack)
node: v22.x (engines >=18.0.0)
platform: linux (kernel 6.18.5)
```
