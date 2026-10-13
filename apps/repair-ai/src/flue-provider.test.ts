import assert from "node:assert/strict";
import test from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { MODEL } from "./budget.ts";
import { budgetedFlueProvider, type FlueBudgetService } from "./flue-provider.ts";

const original =
  'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":45,"completion_tokens":2,"total_tokens":47}}\n\ndata: [DONE]\n\n';
const input = {
  messages: [
    { role: "user" as const, content: "Reply with only OK. Do not use tools.", timestamp: 0 },
  ],
};
function harness(
  body = original,
  override?: Partial<Awaited<ReturnType<FlueBudgetService["runStream"]>>>,
) {
  let calls = 0;
  const provider = budgetedFlueProvider(
    "owned",
    {
      async runStream(run, id, model, payload) {
        assert.equal(run, "owned");
        assert.equal(id, "owned_1");
        assert.equal(model, MODEL);
        assert.deepEqual(payload, {
          messages: [{ role: "user", content: input.messages[0].content }],
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: 128,
          temperature: 0,
        });
        calls++;
        return {
          reservationId: id,
          reservedCents: 10,
          body,
          byteLength: Buffer.byteLength(body),
          contentType: "text/event-stream",
          ...override,
        };
      },
    },
    () => "owned_1",
  );
  const models = createModels();
  models.setProvider(provider);
  const model = models.getModel("cloudflare", MODEL)!;
  return { models, model, provider, calls: () => calls };
}

test("actual pinned Flue provider consumes original SSE with gateway disabled", async () => {
  const h = harness();
  assert.deepEqual(
    h.provider.getModels().map((model) => model.id),
    [MODEL],
  );
  const result = await h.models.completeSimple(h.model, input, { maxTokens: 128, temperature: 0 });
  assert.equal(result.stopReason, "stop");
  assert.equal(result.content[0]?.type, "text");
  assert.equal(result.content[0]?.type === "text" && result.content[0].text, "OK");
  assert.equal(result.usage.totalTokens, 47);
  assert.equal(h.calls(), 1);
});

test("missing native finish is not repaired into successful completion", async () => {
  const h = harness('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
  const result = await h.models.completeSimple(h.model, input, { maxTokens: 128, temperature: 0 });
  assert.equal(result.stopReason, "error");
  assert.equal(h.calls(), 1);
});

test("invalid receipt and token override produce redacted errors without provider retry", async () => {
  const h = harness(original, { reservationId: "foreign" });
  const failed = await h.models.completeSimple(h.model, input, { maxTokens: 128, temperature: 0 });
  assert.equal(failed.stopReason, "error");
  assert.match(failed.errorMessage!, /Budgeted Flue inference failed/);
  assert.equal(h.calls(), 1);
  const repeated = await h.models.completeSimple(h.model, input, {
    maxTokens: 128,
    temperature: 0,
  });
  assert.equal(repeated.stopReason, "error");
  assert.equal(h.calls(), 1);
  const denied = harness();
  const invalid = await denied.models.completeSimple(denied.model, input, {
    maxTokens: 2049,
    temperature: 0,
  });
  assert.equal(invalid.stopReason, "error");
  assert.equal(denied.calls(), 0);
});

test("tools, model overrides and extra headers never reach the budget service", async () => {
  for (const options of [
    { maxTokens: 128, temperature: 0, headers: { authorization: "private" } },
    {
      maxTokens: 128,
      temperature: 0,
      onPayload: (payload: unknown) => ({ ...(payload as object), tools: [] }),
    },
  ]) {
    const h = harness();
    const result = await h.models.completeSimple(h.model, input, options);
    assert.equal(result.stopReason, "error");
    assert.equal(h.calls(), 0);
    assert.ok(!result.errorMessage?.includes("private"));
  }
  const h = harness();
  const result = await h.models.completeSimple({ ...h.model, id: "other-model" }, input, {
    maxTokens: 128,
    temperature: 0,
  });
  assert.equal(result.stopReason, "error");
  assert.equal(h.calls(), 0);
});
