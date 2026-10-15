import assert from "node:assert/strict";
import test from "node:test";
import { worker, type WorkerEnvironment } from "./worker.ts";

test("mounted runner authenticates before enrollment and returns matching status/event routes", async () => {
  const created: unknown[] = [];
  const reads: string[] = [];
  const cursors: unknown[] = [];
  let checks = 0;
  let disposed = 0;
  const environment = {
    EFFECT_CI_API_TOKEN: "fixture",
    GITHUB_APP_ID: "unused",
    GITHUB_PRIVATE_KEY: "unused",
    GITHUB_WEBHOOK_SECRET: "unused",
  } as WorkerEnvironment;
  const application = worker({
    routePrefix: "/demo",
    remoteRunAllowed: (input) => {
      checks++;
      return input.repository === "https://github.com/owner/repo.git";
    },
    workflow: () =>
      ({
        create: async (input: unknown) => {
          created.push(input);
        },
        get: async (id: string) => {
          reads.push(id);
          return {
            status: async () => ({ status: "complete" }),
            subscribe: async (cursor: unknown) => {
              cursors.push(cursor);
              let read = false;
              return {
                next: async () =>
                  read
                    ? { done: true }
                    : ((read = true),
                      {
                        done: false,
                        value: { eventId: 2, type: "workflow_completed" },
                      }),
                [Symbol.dispose]: () => {
                  disposed++;
                },
              };
            },
          };
        },
      }) as unknown as Workflow,
  });
  const input = { repository: "https://github.com/owner/repo.git", revision: "a".repeat(40) };
  const dispatch = (token: string, body = input) =>
    application.fetch(
      new Request("https://ci.invalid/demo/runs", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      environment,
    );
  assert.equal((await dispatch("wrong")).status, 401);
  assert.equal(checks, 0);
  assert.equal(
    (await dispatch("fixture", { ...input, repository: "https://github.com/foreign/repo.git" }))
      .status,
    403,
  );
  assert.equal(created.length, 0);
  const response = await dispatch("fixture");
  assert.equal(response.status, 202);
  const result = (await response.json()) as {
    instanceId: string;
    eventsUrl: string;
    statusUrl: string;
  };
  assert.equal(result.eventsUrl, `https://ci.invalid/demo/runs/${result.instanceId}/events`);
  assert.equal(result.statusUrl, `https://ci.invalid/demo/runs/${result.instanceId}`);
  const headers = { authorization: "Bearer fixture" };
  assert.equal((await application.fetch(new Request(result.statusUrl), environment)).status, 401);
  assert.equal(
    (await application.fetch(new Request(result.statusUrl, { headers }), environment)).status,
    200,
  );
  const events = await application.fetch(
    new Request(result.eventsUrl + "?cursor=1", { headers }),
    environment,
  );
  assert.match(await events.text(), /workflow_completed/);
  assert.deepEqual(reads, [result.instanceId, result.instanceId]);
  assert.deepEqual(cursors, [{ cursor: 1 }]);
  assert.equal(disposed, 1);
  assert.equal(
    (
      await application.fetch(
        new Request("https://ci.invalid/demolition/runs", { method: "POST" }),
        environment,
      )
    ).status,
    404,
  );
});

test("workflow mount points are host configuration, not arbitrary URL fragments", () => {
  for (const routePrefix of [
    "/",
    "demo",
    "/demo/",
    "/demo?x",
    "/../demo",
    "https://other.invalid",
  ]) {
    assert.throws(() => worker({ routePrefix }), /Invalid workflow route prefix/);
  }
});
