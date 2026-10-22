import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { worker, type WorkerEnvironment, type GitHubClient } from "./worker.ts";

test("GitHub selector runs only after signature/App validation and deduplicates on the selected Workflow", async () => {
  const selected: any[] = [],
    normal: any[] = [],
    checks: any[] = [];
  let selections = 0,
    tokens = 0;
  const binding = (created: any[]) =>
    ({
      create: async (input: any) => {
        created.push(input);
      },
      get: async (id: string) => ({
        status: async () => {
          if (!created.some((c) => c.id === id)) throw Error("Absent");
          return { status: "complete" };
        },
      }),
    }) as unknown as Workflow;
  const demo = binding(selected),
    fallback = binding(normal);
  const github = {
    createInstallationToken: async () => {
      tokens++;
      return "fake-token";
    },
    createCheck: async (input: any) => {
      checks.push(input);
      return { id: 100 + checks.length };
    },
    updateCheck: async () => {},
  } as unknown as GitHubClient;
  const environment = {
    GITHUB_APP_ID: "1",
    GITHUB_PRIVATE_KEY: "unused",
    GITHUB_WEBHOOK_SECRET: "local-fixture",
  } as WorkerEnvironment;
  const application = worker({
    workflow: () => fallback,
    github,
    githubPushRun: (identity) =>
      identity.ref === "refs/heads/demo/release"
        ? { workflow: demo, detailsUrl: "https://dash.example/release" }
        : false,
    githubRun: (identity) => {
      selections++;
      assert.equal(identity.trigger, "github");
      return identity.ref === "refs/heads/demo/live"
        ? { workflow: demo, detailsUrl: "https://dash.example/selected" }
        : undefined;
    },
  });
  const payload = (branch = "demo/live", app = 1) => ({
    action: "requested",
    check_suite: { app: { id: app }, head_branch: branch, head_sha: "a".repeat(40) },
    installation: { id: 2 },
    repository: { clone_url: "https://github.com/owner/repo.git", full_name: "owner/repo" },
    detailsUrl: "https://evil.invalid",
  });
  const dispatch = async (id: string, p: unknown = payload(), signed = true, event = "check_suite") => {
    const body = JSON.stringify(p);
    return application.fetch(
      new Request("https://ci.invalid/webhooks/github", {
        method: "POST",
        body,
        headers: {
          "x-github-event": event,
          "x-github-delivery": id,
          "x-hub-signature-256": signed
            ? "sha256=" + createHmac("sha256", "local-fixture").update(body).digest("hex")
            : "wrong",
        },
      }),
      environment,
    );
  };
  const push = {
    ref: "refs/heads/demo/release",
    after: "b".repeat(40),
    deleted: false,
    forced: false,
    installation: { id: 2 },
    repository: { clone_url: "https://github.com/owner/repo.git", full_name: "owner/repo" },
  };
  assert.equal((await dispatch("unsigned", payload(), false)).status, 401);
  assert.equal(selections, 0);
  assert.equal(tokens, 0);
  await dispatch("foreign-app", payload("demo/live", 9));
  assert.equal(selections, 0);
  const pushed = await dispatch("release-push", push, true, "push");
  assert.equal(pushed.status, 202);
  assert.deepEqual(await pushed.json(), { accepted: true, instanceId: "release-push" });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].params.ref, "refs/heads/demo/release");
  assert.equal(selected[0].params.revision, "b".repeat(40));
  assert.equal(selected[0].params.detailsUrl, "https://dash.example/release");
  assert.equal(checks[0].detailsUrl, "https://dash.example/release");
  const duplicatePush = await (await dispatch("release-push", push, true, "push")).json() as { duplicate: boolean };
  assert.equal(duplicatePush.duplicate, true);
  for (const invalid of [
    { ...push, forced: true },
    { ...push, deleted: true },
    { ...push, ref: "refs/tags/release" },
    { ...push, after: "B".repeat(40) },
  ]) {
    const response = await dispatch("invalid-push", invalid, true, "push");
    assert.deepEqual(await response.json(), { accepted: false, reason: "ignored action" });
  }
  assert.equal(selected.length, 1);
  assert.equal((await dispatch("demo")).status, 202);
  assert.equal(selected.length, 2);
  assert.equal(normal.length, 0);
  assert.equal(selected[1].params.ref, "refs/heads/demo/live");
  assert.equal(selected[1].params.detailsUrl, "https://dash.example/selected");
  assert.equal(checks[1].detailsUrl, "https://dash.example/selected");
  const duplicate = (await (await dispatch("demo")).json()) as { duplicate: boolean };
  assert.equal(duplicate.duplicate, true);
  assert.equal(tokens, 2);
  await dispatch("normal", payload("main"));
  assert.equal(normal.length, 1);
  assert.equal(selected.length, 2);
  assert.equal(normal[0].params.detailsUrl, undefined);
});
