import assert from "node:assert/strict";
import test from "node:test";
import { worker, type WorkerEnvironment } from "./worker.ts";

test("execution history is an authenticated, read-only, Schema-validated host projection", async () => {
  const received: Array<{ revision: string; after?: string }> = [];
  let fail = false;
  const api = worker({ routePrefix: "/showcase", workflow: () => ({}) as Workflow,
    executionHistory: async input => {
      received.push(input);
      if (fail) throw Error("private-provider-token");
      return { receipts: [], unverified: 0 };
    },
  });
  const environment = { EFFECT_CI_API_TOKEN: "local-api-token" } as WorkerEnvironment;
  const call = (path: string, authorized = true, method = "GET") => api.fetch(new Request(`https://fixture.invalid/showcase${path}`, {
    method, ...(authorized ? { headers: { authorization: "Bearer local-api-token" } } : {}),
  }), environment);
  const revision = "a".repeat(40), after = "b".repeat(64);
  assert.equal((await call(`/executions?revision=${revision}`, false)).status, 401);
  for (const path of ["/executions", "/executions?revision=main", `/executions?revision=${revision}&revision=${revision}`,
    `/executions?revision=${revision}&after=foreign`, `/executions?revision=${revision}&after=${after}&after=${after}`])
    assert.equal((await call(path)).status, 400);
  assert.equal((await call(`/executions?revision=${revision}`, true, "POST")).status, 404);
  assert.equal(received.length, 0);
  const response = await call(`/executions?revision=${revision}&after=${after}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { receipts: [], unverified: 0 });
  assert.deepEqual(received, [{ revision, after }]);
  const capabilities = await (await call("/capabilities")).json() as { executionHistory?: boolean };
  assert.equal(capabilities.executionHistory, true);
  fail = true;
  const unavailable = await call(`/executions?revision=${revision}`);
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes("private-provider-token"));
});

test("remote compute reruns require explicit host opt-in and an explicit goal before creation", async () => {
  const calls: unknown[] = [];
  const workflow = { create: async (input: unknown) => { calls.push(input); return {}; } } as unknown as Workflow;
  const environment = { EFFECT_CI_API_TOKEN: "fixture-token" } as WorkerEnvironment;
  const input = { repository: "https://github.com/example/project.git", revision: "a".repeat(40), targets: ["test"],
    rerunFrom: "11111111-1111-4111-8111-111111111111" };
  const post = (api: ReturnType<typeof worker>, body: unknown) => api.fetch(new Request("https://fixture.invalid/runs", {
    method: "POST", headers: { authorization: "Bearer fixture-token" }, body: JSON.stringify(body),
  }), environment);
  const legacy = worker({ workflow: () => workflow, remoteTargets: ["test"] });
  assert.equal((await post(legacy, input)).status, 403);
  const enrolled = worker({ workflow: () => workflow, remoteTargets: ["test"], remoteRerun: true });
  assert.equal((await post(enrolled, { ...input, targets: undefined })).status, 403);
  assert.equal((await post(enrolled, { ...input, rerunFrom: "foreign" })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await post(enrolled, input)).status, 202);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { params: { rerunFrom: string } }).params.rerunFrom, input.rerunFrom);
});
