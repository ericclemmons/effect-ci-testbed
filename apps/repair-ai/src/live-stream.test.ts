import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { BUDGET_NAME } from "./budget.ts";
import { streamSummary } from "./budget-stream.ts";

/** Retained native evidence only; no dispatch, deployment or inference. */
test(
  "native streaming preserves actual finish/usage bytes and one charged reservation",
  {
    skip: !process.env.LIVE_REPAIR_STREAM_INSTANCE,
  },
  () => {
    const id = process.env.LIVE_REPAIR_STREAM_INSTANCE!;
    assert.match(id, /^[a-zA-Z0-9_-]{1,80}$/);
    const get = (args: string[]) =>
      JSON.parse(
        execFileSync(process.env.CF_BIN ?? "cf", args, {
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        }),
      );
    const run = get([
      "workflows",
      "instances",
      "get",
      id,
      "--workflow-name",
      "effect-ci-repair-budget-probe",
    ]);
    assert.equal(run.status, "complete");
    assert.equal(run.params.mode, "stream");
    assert.deepEqual(
      run.steps.map((entry: any) => entry.name),
      ["budget:before-1", "budget:owned-stream-1", "budget:after-1"],
    );
    assert.ok(
      run.steps.every(
        (entry: any) =>
          entry.success && entry.attempts.length === 1 && entry.config.retries.limit === 0,
      ),
    );
    const result = run.output;
    assert.equal(result.before.budget, BUDGET_NAME);
    assert.equal(result.after.budget, BUDGET_NAME);
    assert.equal(result.after.reservedCents, result.before.reservedCents + 10);
    assert.equal(result.after.remainingCents + result.after.reservedCents, 200);
    assert.equal(result.reservationId, `probe_${id}`);
    assert.equal(
      result.after.reservations.filter((entry: any) => entry.id === result.reservationId).length,
      1,
    );
    assert.equal(result.inferenceCalled, true);
    assert.equal(result.flueVerified, false);
    assert.equal(result.repairVerified, false);
    const step = get([
      "workflows",
      "instances",
      "step",
      "get",
      id,
      "--workflow-name",
      "effect-ci-repair-budget-probe",
      "--name",
      "budget:owned-stream-1",
      "--type",
      "step",
    ]).result;
    assert.equal(step.status, "complete");
    assert.equal(step.error, null);
    assert.equal(step.output.reservationId, result.reservationId);
    assert.equal(step.output.contentType, "text/event-stream");
    assert.equal(Buffer.byteLength(step.output.body), result.byteLength);
    assert.ok(result.byteLength > 0 && result.byteLength <= 65536);
    assert.deepEqual(streamSummary(step.output.body), result.protocol);
    assert.equal(result.protocol.openAiChoices, true);
    assert.equal(result.protocol.finishReason, true);
    assert.equal(result.protocol.doneSentinel, true);
    const records = step.output.body
      .split(/\r?\n/)
      .filter((line: string) => line.startsWith("data:") && line.slice(5).trim() !== "[DONE]")
      .map((line: string) => JSON.parse(line.slice(5)));
    assert.ok(
      records.some((record: any) =>
        record.choices?.some((choice: any) => choice.finish_reason === "stop"),
      ),
    );
    assert.ok(records.some((record: any) => record.usage?.total_tokens > 0));
    assert.ok(
      !/gh[spr]_[A-Za-z0-9]+|x-access-token:|Bearer /.test(JSON.stringify(run) + step.output.body),
    );
  },
);
