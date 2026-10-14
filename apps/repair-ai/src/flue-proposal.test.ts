import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { init, useModel } from "@flue/runtime";
import { start, sqlite } from "@flue/runtime/node";
import { createModels } from "@earendil-works/pi-ai";
import { MODEL } from "./budget.ts";
import { budgetedFlueProvider } from "./flue-provider.ts";
import { assertProposalStream, flueProposalInput } from "./flue-policy.ts";

const proposal = "export function healthStatus() { return 200; }";
const original = `data: ${JSON.stringify({ choices: [{ delta: { content: proposal }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 } })}\n\ndata: [DONE]\n\n`;

test(
  "actual Flue proposal completes and persisted read survives restart without another broker call",
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "effect-ci-flue-proposal-test-"));
    let calls = 0;
    function OwnedProposal() {
      useModel(`cloudflare/${MODEL}`, { compaction: false });
      return "Propose only the corrected function for owned fixture healthStatus returning 500. Expected 200. Never delegate or use tools.";
    }
    OwnedProposal.durability = { maxAttempts: 1, timeoutMs: 5000 };
    const makeProvider = () =>
      budgetedFlueProvider(
        "owned-proposal",
        {
          async runStream(run, id, model, input) {
            assert.equal(run, "owned-proposal");
            assert.equal(model, MODEL);
            assert.equal("tools" in (input as object), false);
            assert.equal("extraHeaders" in (input as object), false);
            assert.equal("gateway" in (input as object), false);
            calls++;
            return {
              reservationId: id,
              reservedCents: 10,
              body: original,
              byteLength: Buffer.byteLength(original),
              contentType: "text/event-stream",
            };
          },
        },
        () => "owned-proposal-1",
        { proposalOnly: true },
      );
    let runtime: Awaited<ReturnType<typeof start>> | undefined;
    try {
      runtime = await start({
        agents: [OwnedProposal],
        env: {},
        db: sqlite(join(dir, "agent.db")),
        providers: [makeProvider()],
      });
      const handle = init(OwnedProposal, { id: "owned-proposal" });
      const receipt = await handle.dispatch("Fix only healthStatus. No commands or explanation.");
      const reply = await handle.read(receipt, { signal: AbortSignal.timeout(10000) });
      assert.equal(reply.text, proposal);
      assert.equal(calls, 1);
      await runtime.stop();
      runtime = undefined;
      runtime = await start({
        agents: [OwnedProposal],
        env: {},
        db: sqlite(join(dir, "agent.db")),
        providers: [makeProvider()],
      });
      const restored = init(OwnedProposal, { id: "owned-proposal" });
      assert.deepEqual(await restored.read(receipt, { signal: AbortSignal.timeout(5000) }), reply);
      assert.equal(calls, 1);
    } finally {
      await runtime?.stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("proposal-only transport still rejects custom tools, arbitrary headers and model overrides", async () => {
  for (const kind of ["tool", "header", "model"]) {
    let calls = 0;
    const provider = budgetedFlueProvider(
      "owned",
      {
        async runStream() {
          calls++;
          throw Error("must not run");
        },
      },
      () => "owned-1",
      { proposalOnly: true },
    );
    const models = createModels();
    models.setProvider(provider);
    const model = models.getModel("cloudflare", MODEL)!;
    const context = {
      messages: [{ role: "user" as const, content: "owned", timestamp: 0 }],
      ...(kind === "tool"
        ? {
            tools: [
              {
                name: "shell",
                description: "unsafe",
                parameters: { type: "object" as const, properties: {} },
              },
            ],
          }
        : {}),
    };
    const result = await models.completeSimple(
      kind === "model" ? { ...model, id: "other" } : model,
      context,
      {
        maxTokens: 128,
        temperature: 0,
        ...(kind === "header" ? { headers: { authorization: "private" } } : {}),
      },
    );
    assert.equal(result.stopReason, "error");
    assert.equal(calls, 0);
    assert.ok(!result.errorMessage?.includes("private"));
  }
});

test("tool responses are rejected before reaching Flue and do not trigger another broker call", async () => {
  const malicious =
    'data: {"choices":[{"delta":{"tool_calls":[{"id":"x","type":"function","function":{"name":"task","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n';
  assert.throws(() => assertProposalStream(malicious), /request rejected/);
  assert.doesNotThrow(() => assertProposalStream(original));
  let calls = 0;
  const provider = budgetedFlueProvider(
    "owned",
    {
      async runStream(_run, id) {
        calls++;
        return {
          reservationId: id,
          reservedCents: 10,
          body: malicious,
          byteLength: Buffer.byteLength(malicious),
          contentType: "text/event-stream",
        };
      },
    },
    () => "owned-1",
    { proposalOnly: true },
  );
  const models = createModels();
  models.setProvider(provider);
  const model = models.getModel("cloudflare", MODEL)!;
  const context = { messages: [{ role: "user" as const, content: "owned", timestamp: 0 }] };
  assert.equal(
    (await models.completeSimple(model, context, { maxTokens: 128, temperature: 0 })).stopReason,
    "error",
  );
  assert.equal(
    (await models.completeSimple(model, context, { maxTokens: 128, temperature: 0 })).stopReason,
    "error",
  );
  assert.equal(calls, 1);
});

test("proposal policy rejects non-text blocks, accessors and forged session hints without evaluating them", async () => {
  let getters = 0;
  const base = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
    ],
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: 128,
    temperature: 0,
  };
  const copied = await flueProposalInput(MODEL, base, { returnRawResponse: true });
  assert.equal(copied.messages[0].content, "one\ntwo");
  const accessor = Object.defineProperty({}, "text", {
    get() {
      getters++;
      throw Error("private");
    },
    enumerable: true,
  });
  for (const content of [
    [{ type: "image_url", image_url: { url: "https://untrusted.invalid" } }],
    [accessor],
    [{ type: "text", text: "x", unexpected: true }],
  ]) {
    await assert.rejects(
      flueProposalInput(
        MODEL,
        { ...base, messages: [{ role: "user", content }] },
        { returnRawResponse: true },
      ),
      { message: "Flue inference request rejected" },
    );
  }
  for (const extraHeaders of [
    { "x-session-affinity": "arbitrary" },
    { authorization: "private" },
    { "x-session-affinity": "aff_01M4W0HPZ73QN4MS4VJ41655GC", authorization: "private" },
  ]) {
    await assert.rejects(
      flueProposalInput(MODEL, base, { returnRawResponse: true, extraHeaders }),
      /request rejected/,
    );
  }
  assert.equal(getters, 0);
});
