import assert from "node:assert/strict";
import test from "node:test";
import type * as CI from "@effect-ci-testbed/ci";
import type { WorkflowStep } from "cloudflare:workers";
import { makeHostAttemptHandler } from "./host-attempt.ts";

const attempt = (id: string, mode: "plan" | "execute" = "execute"): CI.WorkflowAttempt => ({
  id,
  number: 1,
  workflowId: "fixture",
  requested: [],
  plan: { workflowId: "fixture", environment: "cloudflare", mode, nodes: [] },
  outputs: {},
  conclusion: "success",
  startedAt: "2026-10-18T00:00:00.000Z",
  completedAt: "2026-10-18T00:00:01.000Z",
});

test("host recording uses the stable native run/attempt number, not the replay-local kernel UUID", async () => {
  const completed = new Map<string, unknown>(),
    keys: string[] = [];
  let calls = 0;
  const step = {
    do: async (name: string, options: any, body: () => Promise<void>) => {
      assert.deepEqual(options, { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" });
      keys.push(name);
      if (!completed.has(name)) completed.set(name, await body());
      return completed.get(name);
    },
  } as unknown as WorkflowStep;
  const context = {
    instanceId: "native-id",
    parameters: { repository: "https://github.com/acme/private" },
    environment: { key: "host-only" },
    exports: {},
  };
  const record = makeHostAttemptHandler(
    step,
    async (actual, received) => {
      assert.equal(actual.id, "first-ephemeral-id");
      assert.equal(received, context);
      calls++;
    },
    context,
  );
  await record(attempt("first-ephemeral-id"));
  await record(attempt("different-replay-id"));
  assert.equal(calls, 1);
  assert.deepEqual(keys, ["host-attempt:1", "host-attempt:1"]);
  assert.deepEqual(
    [...completed.values()],
    [undefined],
    "Never serialize host context or the handler's output",
  );
});

test("planning never records and private callback failures are redacted inside the native checkpoint", async () => {
  let checkpoints = 0,
    calls = 0;
  const step = {
    do: async (_name: string, _options: unknown, body: () => Promise<void>) => {
      checkpoints++;
      return body();
    },
  } as unknown as WorkflowStep;
  const record = makeHostAttemptHandler(
    step,
    async () => {
      calls++;
      throw Error("PRIVATE_SIGNER_ERROR");
    },
    { instanceId: "native-id", parameters: {}, environment: {}, exports: {} },
  );
  await record(attempt("planning", "plan"));
  assert.equal(checkpoints, 0);
  await assert.rejects(
    async () => {
      await record(attempt("execute"));
    },
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Host attempt recording failed" &&
      error.cause === undefined,
  );
  assert.equal(checkpoints, 1);
  assert.equal(calls, 1);
  await assert.rejects(async () => {
    await record({ ...attempt("bad"), number: 0 });
  }, /Invalid host attempt number/);
  assert.equal(checkpoints, 1);
});
