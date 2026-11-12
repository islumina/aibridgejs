import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { createBridge } from "../src/index.js";
import { createMockAdapter } from "../src/mock/index.js";

// Drain the microtask queue (ready() gate + post() dispatch chains) by yielding
// once to the macrotask queue. After this resolves, every spawned call() has
// posted its request envelope.
const flushMacrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("aibridgejs property: request/response id correlation", () => {
  test("N concurrent calls get unique ids and each resolves to its own response, independent of response arrival order", async () => {
    await fc.assert(
      fc.asyncProperty(
        // n drives the concurrency; `order` is a full-length permutation of
        // [0, n) that decides the order responses are pushed back, so the
        // routing invariant is exercised against arbitrary arrival orders.
        fc.integer({ min: 1, max: 50 }).chain((n) =>
          fc.record({
            n: fc.constant(n),
            order: fc.shuffledSubarray([...Array(n).keys()], {
              minLength: n,
              maxLength: n,
            }),
          }),
        ),
        async ({ n, order }) => {
          const adapter = createMockAdapter();
          const requests: { id: string; method: string }[] = [];
          adapter.subscribe((envelope) => {
            if (envelope.kind === "request") {
              requests.push({ id: envelope.id, method: envelope.method });
            }
          });
          const bridge = createBridge({ adapter });

          // Each call uses a distinct method `m{i}` so the response payload can
          // be traced back to the originating call.
          const calls = Array.from({ length: n }, (_, i) => bridge.call<{ echo: string }>(`m${i}`));

          await flushMacrotask();

          // Invariant 1: every concurrent call produced a request with a unique id.
          expect(requests).toHaveLength(n);
          const ids = requests.map((r) => r.id);
          expect(new Set(ids).size).toBe(n);

          // Push responses back in the permuted order. The payload echoes the
          // request's own method, so a misrouted response is detectable.
          for (const idx of order) {
            const req = requests[idx];
            if (!req) throw new Error(`unreachable: no request at index ${idx}`);
            adapter.receive({
              kind: "response",
              id: req.id,
              ok: true,
              payload: { echo: req.method },
              timestamp: Date.now(),
            });
          }

          const results = await Promise.all(calls);

          // Invariant 2: call i resolves with the response addressed to its own
          // id, regardless of the order responses arrived in.
          results.forEach((res, i) => {
            expect(res).toEqual({ echo: `m${i}` });
          });

          bridge.dispose();
        },
      ),
      { numRuns: 50 },
    );
  });
});
