import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { worker, type GitHubClient, type WorkerEnvironment } from "@effect-ci-testbed/github-cloudflare/worker";
import { demoGitHubRun } from "./demo-policy.ts";
import { monorepoGitHubRun } from "./monorepo-policy.ts";
import { showcaseCheckSuiteRun, showcaseGitHubRun } from "./showcase-policy.ts";

const secret = "signed-routing-fixture";
function fixture(githubRun = demoGitHubRun, githubPushRun?: typeof showcaseGitHubRun) {
  const selected: any[] = [], showcase: any[] = [], fallback: any[] = [], checks: any[] = [];
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
    githubRun,
    ...(githubPushRun ? { githubPushRun } : {}),
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
    EFFECT_CI_DETAILS_URL: "https://dash.cloudflare.com/account/workers/workflows/effect-ci-github-cloudflare/instance/{id}",
  } as WorkerEnvironment;
  const context = { exports: { DemoCIWorkflow: binding(selected), EffectCIWorkflow: binding(selected), ShowcaseCIWorkflow: binding(showcase) } } as unknown as ExecutionContext;
  const dispatch = (id: string, repository = "ericclemmons/effect-ci-testbed", branch = "main",
    installation = 165265172, app = 5089816, valid = true, event = "check_suite") => {
    const identity = {
      installation: { id: installation },
      repository: { full_name: repository, clone_url: `https://github.com/${repository}.git` },
    };
    const body = JSON.stringify(event === "push" ? {
      ...identity, ref: `refs/heads/${branch}`, after: "a".repeat(40), deleted: false, forced: false,
    } : {
      ...identity, action: "requested", check_suite: { app: { id: app }, head_branch: branch, head_sha: "a".repeat(40) },
    });
    return application.fetch(new Request("https://ci.invalid/webhooks/github", {
      method: "POST", body, headers: {
        "x-github-event": event, "x-github-delivery": id,
        "x-hub-signature-256": valid ? "sha256=" + createHmac("sha256", secret).update(body).digest("hex") : "invalid",
      },
    }), environment, context);
  };
  return { dispatch, selected, showcase, fallback, checks, counts: () => ({ tokens, reads }) };
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

test("signed showcase branches select the authored showcase while main keeps product-only CI", async () => {
  const f = fixture((identity, environment, context) =>
    showcaseCheckSuiteRun(identity, environment, context) ?? monorepoGitHubRun(identity, environment, context),
  showcaseGitHubRun);
  for (const branch of ["demo/showcase-preview", "demo/showcase"]) {
    assert.equal((await f.dispatch(branch, undefined, branch, 165265172, 5089816, true, "push")).status, 202);
  }
  assert.equal(f.showcase.length, 2);
  for (const run of f.showcase) {
    const expected = `https://dash.cloudflare.com/account/workers/workflows/effect-ci-showcase/instance/${encodeURIComponent(run.id)}`;
    assert.equal(run.params.detailsUrl, expected);
    assert.equal(f.checks.find(check => check.externalId === run.id)?.detailsUrl, expected);
  }
  for (const branch of ["demo/showcase-preview", "demo/showcase"]) {
    const response = await f.dispatch(`suite-${branch}`, undefined, branch);
    assert.deepEqual(await response.json(), { accepted: false, reason: "workflow not enrolled" });
  }
  assert.equal(f.showcase.length, 2, "check suites do not duplicate push-owned showcase runs");
  assert.equal(f.selected.length, 0);
  assert.equal((await f.dispatch("ordinary-main", undefined, "main")).status, 202);
  assert.equal(f.selected.length, 1);
  assert.equal(f.checks.at(-1).detailsUrl, "https://dash.cloudflare.com/account/workers/workflows/effect-ci-github-cloudflare/instance/ordinary-main");
  assert.equal(f.showcase.length, 2);
  const before = f.counts().tokens;
  assert.equal((await f.dispatch("unsigned-showcase", undefined, "demo/showcase", 165265172, 5089816, false, "push")).status, 401);
  await f.dispatch("unenrolled-showcase", "other/repo", "demo/showcase", 165265172, 5089816, true, "push");
  assert.equal(f.counts().tokens, before);
  assert.equal(f.showcase.length, 2);
  assert.equal(f.fallback.length, 0);
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

test("the signed monorepo enrollment selects root native CI and deduplicates deliveries, not the demo", async () => {
  const f = fixture(monorepoGitHubRun);
  for (const branch of ["main", "feature/tutorial"]) {
    assert.equal((await f.dispatch(branch, undefined, branch)).status, 202);
    const duplicate = await (await f.dispatch(branch, undefined, branch)).json() as { duplicate: boolean };
    assert.equal(duplicate.duplicate, true);
  }
  assert.equal(f.selected.length, 2);
  assert.equal(f.fallback.length, 0);
  assert.equal(f.checks.length, 2);
});
