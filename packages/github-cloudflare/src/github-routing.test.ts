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

test("additional check-suite runs get their own checks and instances without changing the primary run", async () => {
  const primary: any[] = [], examples: any[] = [], checks: any[] = [], updates: any[] = [];
  const binding = (created: any[], fail?: (id: string) => boolean) =>
    ({
      create: async (input: any) => {
        if (fail?.(input.id)) throw Error("private provider detail");
        created.push(input);
      },
      get: async (id: string) => ({
        status: async () => {
          if (!created.some((c) => c.id === id)) throw Error("Absent");
          return { status: "complete" };
        },
      }),
    }) as unknown as Workflow;
  const main = binding(primary), hosted = binding(examples, (id) => id.endsWith("-broken"));
  let selectionThrows = false;
  const application = worker({
    github: {
      createInstallationToken: async () => "fake-token",
      createCheck: async (input: any) => { checks.push(input); return { id: 100 + checks.length }; },
      updateCheck: async (input: any) => { updates.push(input); },
    } as unknown as GitHubClient,
    workflow: () => main,
    githubRun: () => undefined,
    githubCheckSuiteRuns: (identity) => {
      if (selectionThrows) throw Error("host selection bug");
      return identity.ref === "refs/heads/declined" ? [] : [
        { key: "node-npm", workflow: hosted, checkName: "Cloudflare / node-npm", project: { root: "examples/node-npm" } },
        { key: "broken", workflow: hosted, checkName: "Cloudflare / broken" },
      ];
    },
  });
  const environment = { GITHUB_APP_ID: "1", GITHUB_PRIVATE_KEY: "unused", GITHUB_WEBHOOK_SECRET: "local-fixture" } as WorkerEnvironment;
  const dispatch = async (id: string, branch = "main") => {
    const body = JSON.stringify({
      action: "requested",
      check_suite: { app: { id: 1 }, head_branch: branch, head_sha: "a".repeat(40) },
      installation: { id: 2 },
      repository: { clone_url: "https://github.com/owner/repo.git", full_name: "owner/repo" },
    });
    return application.fetch(new Request("https://ci.invalid/webhooks/github", { method: "POST", body, headers: {
      "x-github-event": "check_suite", "x-github-delivery": id,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", "local-fixture").update(body).digest("hex"),
    } }), environment);
  };
  const delivery = "11111111-2222-3333-4444-555555555555";
  const response = await dispatch(delivery);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    accepted: true, instanceId: delivery,
    additional: [
      { key: "node-npm", accepted: true, instanceId: `${delivery}-node-npm` },
      { key: "broken", accepted: false, reason: "failed to start" },
    ],
  });
  assert.equal(primary.length, 1);
  assert.equal(primary[0].params.project, undefined);
  assert.equal(examples.length, 1);
  assert.equal(examples[0].id, `${delivery}-node-npm`);
  assert.deepEqual(examples[0].params.project, { root: "examples/node-npm" });
  assert.equal(examples[0].params.revision, "a".repeat(40));
  assert.deepEqual(checks.map((check) => check.name), ["Effect CI / Cloudflare", "Cloudflare / node-npm", "Cloudflare / broken"]);
  assert.equal(examples[0].params.summaryCheckId, 102);
  // A start failure completes only its own check, without provider details.
  assert.equal(updates.length, 1);
  assert.equal(updates[0].checkId, 103);
  assert.equal(updates[0].conclusion, "failure");
  assert.doesNotMatch(JSON.stringify(updates), /private provider detail/);

  const duplicate = await (await dispatch(delivery)).json() as any;
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.additional[0].duplicate, true);
  assert.equal(examples.length, 1);

  // No selected extras keeps the original response; a selection bug never blocks the primary.
  assert.deepEqual(await (await dispatch("declined", "declined")).json(), { accepted: true, instanceId: "declined" });
  selectionThrows = true;
  assert.deepEqual(await (await dispatch("selection-bug")).json(), { accepted: true, instanceId: "selection-bug" });
  assert.equal(primary.length, 3);
});
