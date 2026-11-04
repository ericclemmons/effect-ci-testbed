import assert from "node:assert/strict";
import test from "node:test";
import {
  infer,
  inputFor,
  MODEL,
  reserve,
  budgetStatus,
  BUDGET_NAME,
  type BudgetStore,
  type Ledger,
} from "./budget.ts";

function memory(initial?: unknown) {
  let value = initial;
  let queue: Promise<unknown> = Promise.resolve();
  const store: BudgetStore = {
    update(operation) {
      const result = queue.then(() => {
        const next = operation(structuredClone(value));
        value = structuredClone(next.ledger);
        return next.result;
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
  return { store, read: () => structuredClone(value) as Ledger };
}
const input = { messages: [{ role: "user", content: "Owned fixture has a failing assertion." }] };

test("concurrent shared lifetime reservations cannot exceed the cumulative $7 authorization", async () => {
  const { store, read } = memory();
  const results = await Promise.allSettled(
    Array.from({ length: 80 }, (_, i) => reserve(store, `run${Math.floor(i / 4)}`, `call${i}`)),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 70);
  assert.equal(read().reservations.length, 70);
  await assert.rejects(reserve(memory(read()).store, "new-run", "new-call"), /exhausted/);
});

test("the work lifetime budget retains charged entries and never refunds or resets", async () => {
  const reservations = Array.from({ length: 20 }, (_, i) => ({
    id: `old${i}`,
    run: `oldrun${Math.floor(i / 4)}`,
  }));
  const { store, read } = memory({ version: 1, reservations });
  assert.equal(BUDGET_NAME, "work-demo-repair-7-usd-20261030-v1");
  assert.equal(budgetStatus(read()).reservedCents, 200);
  assert.equal(budgetStatus(read()).remainingCents, 500);
  await assert.rejects(reserve(store, "new", "old0"), /already consumed/);
  await assert.rejects(reserve(store, "oldrun0", "fifth"), /exhausted/);
  const receipt = await reserve(store, "new", "extension-first");
  assert.equal(receipt.reservedCents, 210);
  assert.equal(budgetStatus(read()).remainingCents, 490);
  assert.deepEqual(read().reservations.slice(0, 20), reservations);
  assert.equal(read().reservations.length, 21);
});

test("replays and per-run limits consume no additional calls", async () => {
  const { store, read } = memory();
  await reserve(store, "run", "first");
  await assert.rejects(reserve(store, "other-run", "first"), /already consumed/);
  for (let i = 1; i < 4; i++) await reserve(store, "run", `next${i}`);
  await assert.rejects(reserve(store, "run", "fifth"), /exhausted/);
  assert.equal(read().reservations.length, 4);
});

test("reservation commits before inference; failures, lost results and malformed outputs retain charge", async () => {
  const { store, read } = memory();
  let calls = 0;
  const failing = {
    async run() {
      calls++;
      assert.equal(read().reservations.length, 1);
      throw new Error("secret transport detail");
    },
  };
  await assert.rejects(infer(store, failing, "run", "first", MODEL, input), {
    message: "Reserved inference failed; reservation retained",
  });
  await assert.rejects(infer(store, failing, "run", "first", MODEL, input), /already consumed/);
  assert.equal(calls, 1);
  await assert.rejects(
    infer(
      store,
      {
        async run() {
          return { tool_calls: [] };
        },
      },
      "run",
      "second",
      MODEL,
      input,
    ),
    /unsupported output/,
  );
  const result = await infer(
    store,
    {
      async run(model, args) {
        assert.equal(model, MODEL);
        assert.equal(args.stream, false);
        assert.equal(args.max_tokens, 2048);
        return { response: "Untrusted proposed text", usage: { ignored: true } };
      },
    },
    "run",
    "third",
    MODEL,
    input,
  );
  assert.equal(result.reservedCents, 30);
  assert.equal(read().reservations.length, 3);
});

test("invalid requests never reserve or reach inference", async () => {
  const { store, read } = memory();
  const binding = {
    async run() {
      assert.fail("invalid request reached inference");
    },
  };
  for (const bad of [
    { ...input, stream: true },
    { ...input, gateway: {} },
    { ...input, tools: [] },
    { ...input, max_tokens: 2049 },
    { ...input, max_tokens: 0 },
    { ...input, temperature: 1 },
    { messages: [] },
    { messages: [{ role: "tool", content: "bad" }] },
    { messages: [{ role: "user", content: "x".repeat(32769) }] },
  ]) {
    await assert.rejects(infer(store, binding, "run", "call", MODEL, bad), /request rejected/);
  }
  await assert.rejects(
    infer(store, binding, "run", "call", "other-model", input),
    /request rejected/,
  );
  await assert.rejects(
    infer(store, binding, "../budget", "call", MODEL, input),
    /request rejected/,
  );
  assert.equal(read(), undefined);
});

test("corrupt ledger fails closed, never resets authorization", async () => {
  for (const current of [
    null,
    {},
    { version: 2, reservations: [] },
    { version: 1, reservations: [], reset: true },
    {
      version: 1,
      reservations: [
        { id: "a", run: "r" },
        { id: "a", run: "r" },
      ],
    },
    { version: 1, reservations: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, run: "r" })) },
  ]) {
    await assert.rejects(reserve(memory(current).store, "r", "new"), /ledger unavailable/);
  }
});

test("ten-cent reservation covers full documented context plus capped output at pinned pricing", () => {
  const conservativeDollars = (24000 * 0.293 + 2048 * 2.253) / 1_000_000;
  assert.ok(conservativeDollars < 0.1);
  assert.deepEqual(inputFor(MODEL, input), {
    ...input,
    max_tokens: 2048,
    stream: false,
    temperature: 0,
  });
});
