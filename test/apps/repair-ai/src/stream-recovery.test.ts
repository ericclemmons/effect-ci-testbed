import assert from "node:assert/strict";
import test from "node:test";
import { MODEL, budgetStatus, type Ledger, type BudgetStore } from "./budget.ts";
import { recoverableStream, type StreamCall, type StreamCallStore } from "./stream-recovery.ts";

const payload = () => ({
  messages: [{ role: "user", content: "OK" }],
  stream: true,
  stream_options: { include_usage: true },
  max_completion_tokens: 128,
  temperature: 0,
});
function fixture() {
  let ledger: Ledger | undefined;
  const records = new Map<string, StreamCall>();
  let invocations = 0;
  const budget: BudgetStore = {
    async update(operation) {
      const next = operation(ledger);
      ledger = next.ledger;
      return next.result;
    },
  };
  const calls: StreamCallStore = {
    async claim(id, initial) {
      const existing = records.get(id);
      if (existing) return { fresh: false, call: structuredClone(existing) };
      records.set(id, structuredClone(initial));
      return { fresh: true, call: structuredClone(initial) };
    },
    async complete(id, call, receipt) {
      records.set(id, { ...call, state: "complete", receipt: structuredClone(receipt) });
    },
  };
  const binding = {
    async run() {
      invocations++;
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  };
  return {
    budget,
    calls,
    binding,
    records,
    count: () => invocations,
    status: () => budgetStatus(ledger),
  };
}
test("fresh host replays original completed SSE with no second reservation or inference", async () => {
  const f = fixture();
  const first = await recoverableStream(
    f.calls,
    f.budget,
    f.binding,
    "run",
    "call",
    MODEL,
    payload(),
  );
  const replay = await recoverableStream(
    { ...f.calls },
    f.budget,
    f.binding,
    "run",
    "call",
    MODEL,
    payload(),
  );
  assert.deepEqual(replay, first);
  assert.equal(f.count(), 1);
  assert.equal(f.status().reservedCents, 10);
  replay.body = "changed by consumer";
  assert.deepEqual(
    await recoverableStream(f.calls, f.budget, f.binding, "run", "call", MODEL, payload()),
    first,
  );
});
test("same-ID changed prompt, run, limits or corrupt receipt cannot replay", async () => {
  const f = fixture();
  await recoverableStream(f.calls, f.budget, f.binding, "run", "call", MODEL, payload());
  for (const [run, input] of [
    ["other", payload()],
    ["run", { ...payload(), max_completion_tokens: 256 }],
    ["run", { ...payload(), messages: [{ role: "user", content: "different" }] }],
  ] as const)
    await assert.rejects(
      recoverableStream(f.calls, f.budget, f.binding, run, "call", MODEL, input),
      /unavailable/,
    );
  f.records.get("call")!.receipt!.byteLength++;
  await assert.rejects(
    recoverableStream(f.calls, f.budget, f.binding, "run", "call", MODEL, payload()),
    /unavailable/,
  );
  assert.equal(f.count(), 1);
});
test("pending, failed and lost persistence outcomes never re-infer after recovery", async () => {
  for (const scenario of ["provider", "save", "lost-ack"] as const) {
    const f = fixture();
    const calls = {
      ...f.calls,
      async complete(...args: Parameters<StreamCallStore["complete"]>) {
        if (scenario === "lost-ack") await f.calls.complete(...args);
        throw new Error("private storage detail");
      },
    };
    const binding =
      scenario === "provider"
        ? {
            async run() {
              throw new Error("private provider detail");
            },
          }
        : f.binding;
    await assert.rejects(
      recoverableStream(calls, f.budget, binding, "run", "call", MODEL, payload()),
      /unavailable/,
    );
    if (scenario === "lost-ack") {
      const replay = await recoverableStream(
        f.calls,
        f.budget,
        f.binding,
        "run",
        "call",
        MODEL,
        payload(),
      );
      assert.match(replay.body, /OK/);
    } else
      await assert.rejects(
        recoverableStream(f.calls, f.budget, f.binding, "run", "call", MODEL, payload()),
        /unavailable/,
      );
    assert.equal(f.status().reservedCents, 10);
    assert.equal(f.count(), scenario === "provider" ? 0 : 1);
  }
});
test("concurrent same-ID calls admit at most one paid request", async () => {
  const f = fixture();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      recoverableStream(f.calls, f.budget, f.binding, "run", "call", MODEL, payload()),
    ),
  );
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(f.count(), 1);
  assert.equal(f.status().reservedCents, 10);
});
