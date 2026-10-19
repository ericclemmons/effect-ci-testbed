import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { worker, type GitHubClient, type WorkerEnvironment } from "@effect-ci-testbed/github-cloudflare/worker";
import { demoGitHubRun } from "./demo-policy.ts";

const secret = "signed-routing-fixture";
function fixture() {
  const selected: any[] = [], fallback: any[] = [], checks: any[] = [];
  let tokens = 0, reads = 0;
  const binding = (created: any[]) => ({
    create: async (input: any) => { created.push(input); },
    get: async (id: string) => ({ status: async () => {
      reads++;
      if (!created.some(value => value.id === id)) throw Error("Absent");
      return { status: "complete" };
    } }),
  }) as unknown as Workflow;
  const application = worker({
    githubRun: demoGitHubRun,
    workflow: () => binding(fallback),
    github: {
      createInstallationToken: async () => { tokens++; return "fixture-token"; },
      createCheck: async (input: any) => { checks.push(input); return { id: 100 + checks.length }; },
      updateCheck: async () => {},
    } as unknown as GitHubClient,
  });
  const environment = {
    GITHUB_APP_ID: "5089816", GITHUB_PRIVATE_KEY: "unused-by-fixture",
    GITHUB_WEBHOOK_SECRET: secret,
  } as WorkerEnvironment;
  const context = { exports: { DemoCIWorkflow: binding(selected) } } as unknown as ExecutionContext;
  const dispatch = (id: string, repository = "ericclemmons/effect-ci-testbed", branch = "main",
    installation = 165265172, app = 5089816, valid = true) => {
    const body = JSON.stringify({
      action: "requested", check_suite: { app: { id: app }, head_branch: branch, head_sha: "a".repeat(40) },
      installation: { id: installation },
      repository: { full_name: repository, clone_url: `https://github.com/${repository}.git` },
    });
    return application.fetch(new Request("https://ci.invalid/webhooks/github", {
      method: "POST", body, headers: {
        "x-github-event": "check_suite", "x-github-delivery": id,
        "x-hub-signature-256": valid ? "sha256=" + createHmac("sha256", secret).update(body).digest("hex") : "invalid",
      },
    }), environment, context);
  };
  return { dispatch, selected, fallback, checks, counts: () => ({ tokens, reads }) };
}

test("a signed check suite for an installed but unenrolled repo starts no default pipeline or checks", async () => {
  const f = fixture();
  for (const repository of ["ericclemmons/effect-ci-private-github-fixture", "ericclemmons/another-repo"]) {
    const response = await f.dispatch(repository, repository, "codex/repair-public-fixture");
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: false, reason: "workflow not enrolled" });
  }
  assert.deepEqual(f.counts(), { tokens: 0, reads: 0 });
  assert.equal(f.checks.length, 0);
  assert.equal(f.fallback.length, 0);
  assert.equal(f.selected.length, 0);
});

test("monorepo main and feature branches never start tutorial deployments or approval gates", async () => {
  const f = fixture();
  for (const branch of ["main", "feature/rehearsal"]) {
    assert.equal((await f.dispatch(branch, undefined, branch)).status, 202);
    assert.deepEqual(await (await f.dispatch(branch, undefined, branch)).json(),
      { accepted: false, reason: "workflow not enrolled" });
  }
  assert.equal(f.selected.length, 0);
  assert.equal(f.fallback.length, 0);
  assert.equal(f.checks.length, 0);
  assert.equal(f.counts().tokens, 0);
});

test("signature, App ownership and installation enrollment remain required", async () => {
  const f = fixture();
  assert.equal((await f.dispatch("unsigned", undefined, "main", 165265172, 5089816, false)).status, 401);
  assert.deepEqual(await (await f.dispatch("foreign-app", undefined, "main", 165265172, 7)).json(),
    { accepted: false, reason: "foreign check suite" });
  assert.deepEqual(await (await f.dispatch("foreign-install", undefined, "main", 7)).json(),
    { accepted: false, reason: "workflow not enrolled" });
  assert.deepEqual(f.counts(), { tokens: 0, reads: 0 });
  assert.equal(f.checks.length, 0);
  assert.equal(f.fallback.length, 0);
  assert.equal(f.selected.length, 0);
});
