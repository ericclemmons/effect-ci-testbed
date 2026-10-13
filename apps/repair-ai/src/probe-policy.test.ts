import assert from "node:assert/strict";
import test from "node:test";
import { budgetStatus, MODEL } from "./budget.ts";
import { runBudgetProbe, type ProbeBudget, type ProbeStep } from "./probe-policy.ts";

function harness() {
  const steps: string[] = [];
  let calls = 0;
  const step: ProbeStep = {
    async do(name, options, callback) {
      assert.equal(options.retries.limit, 0);
      assert.equal(options.timeout, "1 minute");
      steps.push(name);
      return callback();
    },
  };
  const budget: ProbeBudget = {
    async runStream(run, id, model, input) {
      assert.equal(run, "native-budget-probe");
      assert.equal(id, "probe_owned");
      assert.equal(model, MODEL);
      assert.equal((input as { max_completion_tokens: number }).max_completion_tokens, 128);
      calls++;
      return {
        reservedCents: 10,
        reservationId: id,
        body: 'data: {"response":"OK"}\n\ndata: [DONE]\n\n',
        byteLength: 42,
        contentType: "text/event-stream",
      };
    },
    async status() {
      return budgetStatus(
        calls
          ? { version: 1, reservations: [{ run: "native-budget-probe", id: "probe_owned" }] }
          : undefined,
      );
    },
    async run(run, id, model, input) {
      assert.equal(run, "native-budget-probe");
      assert.equal(id, "probe_owned");
      assert.equal(model, MODEL);
      assert.equal((input as { max_tokens: number }).max_tokens, 128);
      calls++;
      return {
        reservedCents: 10,
        reservationId: id,
        response: "export function healthStatus() { return 200; }",
      };
    },
  };
  return { steps, step, budget, calls: () => calls };
}

test("read-only probe never invokes the model", async () => {
  const h = harness();
  const result = await runBudgetProbe("owned", { mode: "inspect" }, h.step, h.budget);
  assert.equal(result.inferenceCalled, false);
  assert.equal(h.calls(), 0);
  assert.deepEqual(h.steps, ["budget:before"]);
});
test("explicit proposal uses one fixed bounded call and reports unverified repair", async () => {
  const h = harness();
  const result = await runBudgetProbe("owned", { mode: "proposal" }, h.step, h.budget);
  assert.equal(h.calls(), 1);
  assert.equal("after" in result && result.after.reservedCents, 10);
  assert.equal("patchApplied" in result && result.patchApplied, false);
  assert.equal("flueVerified" in result && result.flueVerified, false);
  assert.deepEqual(h.steps, ["budget:before", "budget:owned-proposal", "budget:after"]);
});
test("invalid dispatches cannot override model, fixture, budget or prompt", async () => {
  for (const payload of [
    undefined,
    {},
    "proposal",
    { mode: "proposal", prompt: "untrusted" },
    { mode: "reset" },
    { mode: "proposal", model: "other" },
  ]) {
    const h = harness();
    await assert.rejects(runBudgetProbe("owned", payload, h.step, h.budget), /explicit fixed/i);
    assert.equal(h.calls(), 0);
    assert.deepEqual(h.steps, []);
  }
});

test("explicit streaming probe exposes only protocol observations, not model text or Flue proof", async () => {
  const h = harness();
  const result = await runBudgetProbe("owned", { mode: "stream" }, h.step, h.budget);
  assert.equal(h.calls(), 1);
  assert.equal("flueVerified" in result && result.flueVerified, false);
  assert.equal("body" in result, false);
  assert.equal("proposedText" in result, false);
  assert.equal("protocol" in result && result.protocol.finishReason, false);
  assert.deepEqual(h.steps, ["budget:before", "budget:owned-stream", "budget:after"]);
});
