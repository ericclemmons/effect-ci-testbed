import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { MODEL } from "./budget.ts";
import { budgetedFlueProvider } from "./flue-provider.ts";

/** Local retained native bytes only. No network, AI, dispatch or repository writes. */
test(
  "actual Flue parser consumes the digest-bound retained native stream",
  {
    skip: !process.env.LIVE_FLUE_REPLAY_RECEIPT,
  },
  async () => {
    const receipt = JSON.parse(readFileSync(process.env.LIVE_FLUE_REPLAY_RECEIPT!, "utf8"));
    assert.equal(receipt.instanceId, "coverage-repair-budget-stream-20261013-1");
    assert.equal(receipt.step.status, "complete");
    const result = receipt.step.output;
    assert.equal(result.byteLength, 1964);
    assert.equal(
      createHash("sha256").update(result.body).digest("hex"),
      "a53e23adafa3c96b117e82978f5c95ca7c4e170b695625bbd55d3226716ef8bd",
    );
    let calls = 0;
    const models = createModels();
    models.setProvider(
      budgetedFlueProvider(
        "native-budget-probe",
        {
          async runStream(run, id, model, payload) {
            calls++;
            assert.equal(run, "native-budget-probe");
            assert.equal(id, result.reservationId);
            assert.equal(model, MODEL);
            assert.deepEqual(payload, {
              messages: [{ role: "user", content: "Reply with only OK. Do not use tools." }],
              stream: true,
              stream_options: { include_usage: true },
              max_completion_tokens: 128,
              temperature: 0,
            });
            return result; // Replay only; this is NOT the deployed budget RPC.
          },
        },
        () => result.reservationId,
      ),
    );
    const message = await models.completeSimple(
      models.getModel("cloudflare", MODEL)!,
      {
        messages: [
          { role: "user", content: "Reply with only OK. Do not use tools.", timestamp: 0 },
        ],
      },
      { maxTokens: 128, temperature: 0 },
    );
    assert.equal(calls, 1);
    assert.equal(message.stopReason, "stop");
    assert.equal(message.content[0]?.type === "text" && message.content[0].text, "OK");
    assert.equal(message.usage.totalTokens, 47);
    assert.equal(message.responseModel, "@cf/meta/llama-3.3-70b-instruct-sd");
  },
);
