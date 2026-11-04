import assert from "node:assert/strict";
import test from "node:test";
import { publicProposalFixture } from "./public-proposal.fixture.ts";
import { assertPublicAdmission, publicBudget, publicProposalFromHistory, publicProposalMode } from "./public-proposal.ts";

test("public Workflow payload has no caller-selected model or identity and invokes no getters", async () => {
  const f = await publicProposalFixture(); let getters = 0;
  publicProposalMode(f.view.instance, { mode: "proposal" });
  for (const value of [null, [], { mode: "proposal", model: "other" },
    { mode: "proposal", [Symbol()]: true }, { get mode() { getters++; return "proposal"; } }])
    assert.throws(() => publicProposalMode(f.view.instance, value));
  assert.equal(getters, 0);
});

test("fresh public proposal binds immutable admission, original new reply and same lifetime ledger", async () => {
  const f = await publicProposalFixture();
  const checked = await publicProposalFromHistory(f.view.instance, { status: "complete", output: f.output }, f.view, f.after);
  assert.equal(checked.reservationId, f.reservationId);
  assert.equal(checked.admission.issue, f.view.admission.issue);
  assert.equal(checked.text, f.output.proposal.text);
  assert.equal(publicBudget(f.before, true).size, 5);
  const later = { ...f.after, reservedCents: 70, remainingCents: 630,
    reservations: [...f.after.reservations, { id: "other_authorized_local_call", run: "native-budget-probe" }] };
  assert.deepEqual(await publicProposalFromHistory(f.view.instance, { status: "complete", output: f.output }, f.view, later), checked);
});
test("empty/renamed/reset/corrupted ledger and exhausted host reject BEFORE inference", async () => {
  const f = await publicProposalFixture();
  assert.equal(publicBudget({ budget: "work-demo-repair-7-usd-20261030-v1",
    reservedCents: 0, remainingCents: 700, reservations: [] }, true).size, 0);
  for (const bad of [
    { ...f.before, budget: "new-budget" },
    { ...f.before, reservedCents: 0, remainingCents: 700, reservations: [] },
    { ...f.before, reservedCents: 40 },
    { ...f.before, reservations: [...f.before.reservations.slice(1), f.before.reservations[1]] },
    { ...f.before, reservedCents: 70, remainingCents: 630, reservations: [...f.before.reservations,
      { id: "flue_LOCAL3", run: "friday-flue-proposal-v1" }, { id: "flue_LOCAL4", run: "friday-flue-proposal-v1" }] },
  ]) assert.throws(() => publicBudget(bad, true));
});
test("foreign context, old reservation, noncanonical reply and changed model tuple reject", async () => {
  const f = await publicProposalFixture();
  for (const change of [
    (o: any) => o.activationPolicy = "foreign",
    (o: any) => o.githubWritePerformed = true,
    (o: any) => o.admitted.admission.issue = "44444444-4444-4444-4444-444444444444",
    (o: any) => o.proposal.reservationId = f.before.reservations[4].id,
    (o: any) => o.proposal.after = f.before,
    (o: any) => o.proposal.text = "fetch('https://attacker.invalid')",
    (o: any) => o.proposal.receipt.uid = "foreign",
    (o: any) => o.proposal.receipt.acceptedAt = "2026-01-01T00:00:00.000Z",
  ]) {
    const output = structuredClone(f.output); change(output);
    await assert.rejects(publicProposalFromHistory(f.view.instance, { status: "complete", output }, f.view, f.after));
  }
  await assert.rejects(assertPublicAdmission("public-incident-" + "0".repeat(64), f.view));
  await assert.rejects(publicProposalFromHistory(f.view.instance, { status: "running", output: f.output }, f.view, f.after));
});
