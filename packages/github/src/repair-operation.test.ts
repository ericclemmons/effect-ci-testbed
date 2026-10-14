import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  runRecordedRepair,
  operationDigest,
  type OperationStore,
  type RepairResult,
} from "./repair-operation.ts";
import {
  RECORDED_INSTANCE,
  RECORDED_RESERVATION,
  RECORDED_RUN,
  RECORDED_TEXT,
  assertRecordedProposal,
  recordedProposalFromHistory,
} from "./recorded-proposal.ts";
import { FIXED_SOURCE, REPAIR_REPOSITORY } from "./repair.ts";
const evidence = {
  instance: RECORDED_INSTANCE,
  reservationId: RECORDED_RESERVATION,
  run: RECORDED_RUN,
  text: RECORDED_TEXT,
};
const result: RepairResult = {
  repository: REPAIR_REPOSITORY,
  commit: "c".repeat(40),
  sourceDigest: createHash("sha256").update(FIXED_SOURCE).digest("hex"),
  evidenceId: "github_check_123",
  pullRequest: 2,
  url: `https://github.com/${REPAIR_REPOSITORY}/pull/2`,
  created: true,
  deploymentPerformed: false,
};
function history() {
  const old = [
    { id: "old-a", run: "old-run-a" },
    { id: "old-b", run: "old-run-b" },
    { id: "old-c", run: "old-run-c" },
  ];
  const after = [...old, { id: RECORDED_RESERVATION, run: RECORDED_RUN }];
  return {
    native: {
      status: "complete",
      output: {
        text: RECORDED_TEXT,
        reservationId: RECORDED_RESERVATION,
        proposalOnly: true,
        repairVerified: false,
        before: {
          budget: "friday-demo-repair-2-usd-v1",
          reservedCents: 30,
          remainingCents: 670,
          reservations: old,
        },
        after: {
          budget: "friday-demo-repair-2-usd-v1",
          reservedCents: 40,
          remainingCents: 660,
          reservations: after,
        },
      },
    },
    ledger: {
      budget: "friday-demo-repair-2-usd-v1",
      reservedCents: 40,
      remainingCents: 660,
      reservations: after,
    },
  };
}
function harness(initial?: unknown) {
  let record: any = initial,
    readCalls = 0,
    writes = 0;
  const store: OperationStore = {
    read: async () => record,
    claim: async (value) => {
      if (record !== undefined) return false;
      record = value;
      return true;
    },
    complete: async (digest, value) => {
      assert.equal(record.state, "pending");
      assert.equal(record.digest, digest);
      record = { ...record, state: "complete", result: value };
    },
    fail: async (digest) => {
      assert.equal(record.digest, digest);
      if (record.state === "pending") record = { ...record, state: "failed" };
    },
  };
  const run = (propose = async () => result) =>
    runRecordedRepair(
      store,
      async () => {
        readCalls++;
        return evidence;
      },
      async (value) => {
        writes++;
        assert.equal(record.state, "pending", "claim persisted BEFORE writer callback");
        assert.deepEqual(value, evidence);
        return propose();
      },
    );
  return { store, run, state: () => ({ record, readCalls, writes }) };
}
test("retained native history and independent ledger bind the exact proposal, even after later budget calls", () => {
  const h = history();
  assert.deepEqual(recordedProposalFromHistory(h.native, h.ledger), evidence);
  const later = {
    ...h.ledger,
    reservedCents: 50,
    remainingCents: 650,
    reservations: [...h.ledger.reservations, { id: "later", run: "later-run" }],
  };
  assert.deepEqual(recordedProposalFromHistory(h.native, later), evidence);
});
test("unknown native state, changed text, missing/wrong/duplicate reservations or altered history reject", () => {
  for (const flag of [
    "state",
    "text",
    "missing",
    "run",
    "duplicate",
    "history",
    "overbudget",
  ] as const) {
    const h = history();
    if (flag === "state") h.native.status = "running";
    if (flag === "text") h.native.output.text = "model says passed:true";
    if (flag === "missing") h.ledger.reservations = h.ledger.reservations.slice(0, 3);
    if (flag === "run") h.ledger.reservations[3] = { id: RECORDED_RESERVATION, run: "foreign" };
    if (flag === "duplicate") h.ledger.reservations[2] = h.ledger.reservations[1]!;
    if (flag === "history")
      h.native.output.before.reservations = [...h.native.output.before.reservations].reverse();
    if (flag === "overbudget") h.ledger.remainingCents = 999;
    assert.throws(
      () => recordedProposalFromHistory(h.native, h.ledger),
      /Recorded native proposal evidence rejected/,
    );
  }
});
test("accessors and foreign evidence reject without invoking caller code", () => {
  let touched = 0;
  const accessor = { ...evidence };
  Object.defineProperty(accessor, "text", {
    get() {
      touched++;
      throw new Error("secret");
    },
  });
  assert.throws(() => assertRecordedProposal(accessor));
  assert.equal(touched, 0);
  assert.throws(() => assertRecordedProposal({ ...evidence, instance: "foreign-instance" }));
  const h = history();
  Object.defineProperty(h.ledger.reservations, "0", {
    get() {
      touched++;
      throw new Error("secret");
    },
  });
  assert.throws(() => recordedProposalFromHistory(h.native, h.ledger));
  assert.equal(touched, 0);
});
test("one fixed operation persists result before acknowledgement; completed replay reads/writes nothing", async () => {
  const h = harness();
  const first = await h.run();
  assert.equal(first.created, true);
  assert.equal(first.replay, false);
  assert.equal(first.workersIssuesVerified, false);
  const second = await h.run();
  assert.equal(second.created, false);
  assert.equal(second.replay, true);
  assert.equal(first.commit, second.commit);
  assert.equal(h.state().writes, 1);
  assert.equal(h.state().readCalls, 1);
});
test("concurrent admission invokes only one trusted writer", async () => {
  const h = harness();
  const runs = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      h.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return result;
      }),
    ),
  );
  assert.equal(runs.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(h.state().writes, 1);
  assert.equal(h.state().record.state, "complete");
});
test("failed or pending calls keep identity and never retry or pick a fresh operation", async () => {
  const h = harness();
  await assert.rejects(
    h.run(async () => {
      throw new Error("private token secret");
    }),
    /^Error: Owned native repair state rejected; inspect before any recovery$/,
  );
  assert.equal(h.state().record.state, "failed");
  await assert.rejects(h.run());
  assert.equal(h.state().writes, 1);
  assert.equal(h.state().readCalls, 1);
  const pending = harness({ version: 1, state: "pending", digest: await operationDigest() });
  await assert.rejects(pending.run());
  assert.equal(pending.state().writes, 0);
  assert.equal(pending.state().readCalls, 0);
});
test("lost completion acknowledgement preserves completed result and cannot duplicate PR", async () => {
  const h = harness(),
    original = h.store.complete;
  h.store.complete = async (...args) => {
    await original(...args);
    throw new Error("lost acknowledgement");
  };
  await assert.rejects(h.run());
  assert.equal(h.state().record.state, "complete");
  const replay = await h.run();
  assert.equal(replay.replay, true);
  assert.equal(h.state().writes, 1);
});
test("corrupt persisted digest/result and foreign writer destination fail closed", async () => {
  const wrong = harness({ version: 1, state: "complete", digest: "0".repeat(64), result });
  await assert.rejects(wrong.run());
  assert.equal(wrong.state().writes, 0);
  const badResult = harness({
    version: 1,
    state: "complete",
    digest: await operationDigest(),
    result: { ...result, url: "https://foreign.test" },
  });
  await assert.rejects(badResult.run());
  assert.equal(badResult.state().writes, 0);
  const h = harness();
  await assert.rejects(h.run(async () => ({ ...result, sourceDigest: "bad" })));
  assert.equal(h.state().record.state, "failed");
});
