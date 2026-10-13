import assert from "node:assert/strict";
import test from "node:test";
import { budgetStatus, MODEL, type BudgetStore, type Ledger } from "./budget.ts";
import { inferStream, streamSummary } from "./budget-stream.ts";

const payload = () => ({
  messages: [{ role: "user", content: "Say OK" }],
  stream: true,
  stream_options: { include_usage: true },
  max_completion_tokens: 128,
  temperature: 0,
});
function store() {
  let ledger: Ledger | undefined;
  return {
    update(operation) {
      const next = operation(ledger);
      ledger = next.ledger;
      return Promise.resolve(next.result);
    },
    status: () => budgetStatus(ledger),
  } satisfies BudgetStore & { status: () => ReturnType<typeof budgetStatus> };
}
test("stream reserves first and preserves original bounded bytes without inventing completion", async () => {
  const ledger = store();
  const body = 'data: {"response":"OK"}\n\ndata: [DONE]\n\n';
  const result = await inferStream(
    ledger,
    {
      async run(model, input, options) {
        assert.equal(ledger.status().reservedCents, 10);
        assert.equal(model, MODEL);
        assert.equal((input as { max_tokens: number }).max_tokens, 128);
        assert.equal((input as { stream: boolean }).stream, true);
        assert.deepEqual(Object.keys(options).sort(), ["returnRawResponse", "signal"]);
        return new Response(body, {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        });
      },
    },
    "owned",
    "stream_1",
    MODEL,
    payload(),
  );
  assert.equal(result.body, body);
  assert.deepEqual(streamSummary(result.body), {
    events: 2,
    workersAiResponse: true,
    openAiChoices: false,
    finishReason: false,
    doneSentinel: true,
  });
});
test("invalid requests never reserve; unsupported, oversized and interrupted streams retain charge", async () => {
  const ledger = store();
  const binding = {
    async run() {
      throw new Error("private credential");
    },
  };
  await assert.rejects(
    inferStream(ledger, binding, "owned", "invalid", MODEL, { ...payload(), tools: [] }),
    /request rejected/,
  );
  assert.equal(ledger.status().reservedCents, 0);
  for (const [id, response] of [
    ["error", null],
    ["json", Response.json({ response: "OK" })],
    [
      "large",
      new Response("x".repeat(65_537), { headers: { "content-type": "text/event-stream" } }),
    ],
  ] as const) {
    await assert.rejects(
      inferStream(
        ledger,
        {
          async run() {
            if (!response) throw new Error("secret");
            return response;
          },
        },
        "owned",
        id,
        MODEL,
        payload(),
      ),
      { message: "Reserved streaming inference failed; reservation retained" },
    );
  }
  assert.equal(ledger.status().reservedCents, 30);
});
test("deadline aborts and cancels a stalled stream without refund or retry", async () => {
  const ledger = store();
  let cancelled = false;
  let signal: AbortSignal | undefined;
  await assert.rejects(
    inferStream(
      ledger,
      {
        async run(_model, _input, options) {
          signal = options.signal;
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      },
      "owned",
      "timeout",
      MODEL,
      payload(),
      10,
    ),
    /reservation retained/,
  );
  assert.equal(signal?.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(ledger.status().reservedCents, 10);
});
test("protocol summary distinguishes an actual finish reason from a done sentinel", () => {
  assert.equal(streamSummary('data: {"choices":[{"finish_reason":"stop"}]}\n').finishReason, true);
  assert.equal(streamSummary("data: [DONE]\ndata: malformed\n").finishReason, false);
});
