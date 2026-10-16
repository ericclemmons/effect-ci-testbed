import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { publicProposalFixture } from "./public-proposal.fixture.ts";
import { publicProposalFromHistory } from "./public-proposal.ts";
import { runPublicRepair, publicRepairRun, readFailedPublicRepair } from "./public-repair.ts";
import { FIXED_SOURCE, REPAIR_REPOSITORY } from "./repair.ts";
import type { OperationStore } from "./repair-operation.ts";
function memory() {
  let value: any;
  const store: OperationStore = {
    read: async () => value,
    claim: async record => { if (value !== undefined) return false; value = structuredClone(record); return true; },
    complete: async (digest, result) => { assert.equal(value.digest, digest); assert.equal(value.state, "pending"); value = { ...value, state: "complete", result }; },
    fail: async digest => { assert.equal(value.digest, digest); if (value.state === "pending") value.state = "failed"; },
  };
  return { store, current: () => value };
}
const result = { repository: REPAIR_REPOSITORY, commit: "c".repeat(40), sourceDigest: createHash("sha256").update(FIXED_SOURCE).digest("hex"),
  evidenceId: "github_check_123", pullRequest: 4, url: `https://github.com/${REPAIR_REPOSITORY}/pull/4`, created: true, deploymentPerformed: false as const };
async function evidence() {
  const f = await publicProposalFixture();
  return publicProposalFromHistory(f.view.instance, { status: "complete", output: f.output }, f.view, f.after);
}
test("public writer persists fresh evidence before one verified proposal; replay reads nothing", async () => {
  const e = await evidence(), { store, current } = memory();
  let reads = 0, writes = 0;
  const read = async () => (++reads, e);
  const propose = async () => { assert.equal(current().state, "pending"); writes++; return result; };
  const first = await runPublicRepair(e.instance, store, read, propose);
  assert.equal(first.modelReservationId, e.reservationId);
  assert.equal(first.replay, false);
  assert.equal(publicRepairRun(e), "public-33333333333333333333333333333333");
  const replay = await runPublicRepair(e.instance, store, read, propose);
  assert.equal(replay.replay, true);
  assert.equal(replay.created, false);
  assert.deepEqual([reads, writes], [1, 1]);
});
test("pending/failed/foreign/old PR or model evidence cannot create another proposal", async () => {
  const e = await evidence();
  for (const bad of [
    { ...e, reservationId: "flue_54c540e5b12e62cae83001008487f8a26b1652a7664fb511a576e045f8e47c87" },
    { ...e, text: "arbitrary code" },
  ]) {
    const { store } = memory(); let writes = 0;
    await assert.rejects(runPublicRepair(e.instance, store, async () => bad, async () => (++writes, result)));
    assert.equal(writes, 0);
  }
  const { store } = memory(); let writes = 0;
  await assert.rejects(runPublicRepair(e.instance, store, async () => e, async () => { writes++; throw new Error("lost native verification acknowledgement"); }));
  await assert.rejects(runPublicRepair(e.instance, store, async () => e, async () => (++writes, result)));
  assert.equal(writes, 1);
  const other = memory();
  await assert.rejects(runPublicRepair(e.instance, other.store, async () => e, async () => ({ ...result, pullRequest: 3 })));
});
test("lost completed SQLite ACK retains the proposal and never invokes writer again", async () => {
  const e = await evidence(), { store } = memory();
  const complete = store.complete;
  store.complete = async (digest, value) => { await complete(digest, value); throw new Error("persisted, ACK lost"); };
  let writes = 0;
  const propose = async () => (++writes, result);
  await assert.rejects(runPublicRepair(e.instance, store, async () => e, propose));
  assert.equal((await runPublicRepair(e.instance, store, async () => { throw new Error("no reread"); }, propose)).replay, true);
  assert.equal(writes, 1);
});
test("failed public evidence is readable for append-only reconciliation, never reset or silently completed", async () => {
  const e = await evidence(), { store, current } = memory();
  await assert.rejects(runPublicRepair(e.instance, store, async () => e, async () => { throw Error("PR acknowledgement lost"); }));
  const before = structuredClone(current());
  const retained = await readFailedPublicRepair(before);
  assert.deepEqual(retained.evidence, e);
  assert.deepEqual(current(), before);
  for (const bad of [{ ...before, state: "pending" }, { ...before, state: "complete" }, { ...before, digest: "f".repeat(64) }, { ...before, result }])
    await assert.rejects(readFailedPublicRepair(bad));
  let calls = 0;
  await assert.rejects(runPublicRepair(e.instance, store, async () => e, async () => (++calls, result)));
  assert.equal(calls, 0);
});
