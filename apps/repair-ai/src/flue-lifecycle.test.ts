import assert from "node:assert/strict";
import test from "node:test";
import { init, useModel } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { MODEL } from "./budget.ts";
import { budgetedFlueProvider } from "./flue-provider.ts";

// This is the actual submission coordinator, not just the provider parser.
// Admission is not proof that the model ran or that repair succeeded.
test(
  "Flue admission settles failed before spending when its agent request exceeds the guard",
  { timeout: 15_000 },
  async () => {
    let budgetCalls = 0;
    let reservationIds = 0;
    function OwnedProbe() {
      useModel(`cloudflare/${MODEL}`, { compaction: false });
      return "Reply OK. Do not use tools.";
    }
    OwnedProbe.durability = { maxAttempts: 1, timeoutMs: 5_000 };
    const provider = budgetedFlueProvider(
      "lifecycle",
      {
        async runStream() {
          budgetCalls++;
          throw new Error("No inference is authorized by this offline test");
        },
      },
      () => {
        reservationIds++;
        return "lifecycle_1";
      },
    );
    const runtime = await start({ agents: [OwnedProbe], env: {}, providers: [provider] });
    try {
      const handle = init(OwnedProbe, { id: "owned-lifecycle-probe" });
      const receipt = await handle.dispatch("Reply OK");
      assert.ok(receipt.submissionId);
      const failed = (error: unknown) =>
        error instanceof Error &&
        error.name === "AgentRunError" &&
        "outcome" in error &&
        error.outcome === "failed";
      await assert.rejects(handle.read(receipt, { signal: AbortSignal.timeout(10_000) }), failed);
      // Reading a settled submission does not enqueue another attempt or call.
      await assert.rejects(handle.read(receipt), failed);
      assert.equal(budgetCalls, 0);
      assert.equal(reservationIds, 0);
    } finally {
      await runtime.stop();
    }
  },
);
