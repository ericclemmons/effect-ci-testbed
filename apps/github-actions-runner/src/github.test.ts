import assert from "node:assert/strict";
import test from "node:test";
import { GitHub } from "./github.ts";
import { RUNNER_LABEL, type Enrollment } from "./policy.ts";

const policy: Enrollment = { enabled: true, appId: 1, installationId: 2, repositoryId: 3,
  repository: "fixture/private", runnerGroupId: 1, lifetimeSeconds: 900 };
const job = { id: 4, runId: 5, attempt: 1, sha: "a".repeat(40) };
const repo = { id: 3, full_name: "fixture/private", private: true };
const liveJob = { id: 4, run_id: 5, run_attempt: 1, head_sha: job.sha, status: "queued", conclusion: null, labels: [RUNNER_LABEL] };
const liveRun = { id: 5, run_attempt: 1, head_sha: job.sha, event: "push", repository: repo, head_repository: repo };

test("App installation tokens are explicitly reduced to this repo and runner permissions", async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----`;
  const github = new GitHub(policy, privateKey, async (url, init) => {
    assert.equal(url, "https://api.github.com/app/installations/2/access_tokens");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "manual");
    assert.deepEqual(JSON.parse(String(init?.body)), { repository_ids: [3], permissions: { administration: "write", actions: "read" } });
    const jwt = String(new Headers(init?.headers).get("authorization")).slice(7);
    assert.equal(JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()).iss, "1");
    return Response.json({ token: "fixture-token" }, { status: 201 });
  });
  assert.equal(await github.token(), "fixture-token");
});

test("authoritative repository, current job and run are all checked before JIT", async () => {
  const values = new Map<string, unknown>([["", repo], ["/actions/jobs/4", liveJob], ["/actions/runs/5", liveRun]]);
  const github = new GitHub(policy, "unused", async (url) => {
    const path = new URL(String(url)).pathname.replace("/repos/fixture/private", "");
    assert.ok(values.has(path)); return Response.json(values.get(path));
  });
  assert.equal(await github.authorize(job, "fixture-token"), true);
  values.set("/actions/runs/5", { ...liveRun, event: "pull_request_target" });
  assert.equal(await github.authorize(job, "fixture-token"), false);
  values.set("/actions/runs/5", liveRun);
  values.set("/actions/jobs/4", { ...liveJob, status: "completed" });
  assert.equal(await github.authorize(job, "fixture-token"), false);
  values.set("/actions/jobs/4", liveJob);
  values.set("", { ...repo, private: false });
  assert.equal(await github.authorize(job, "fixture-token"), false);
});

test("JIT payload is fixed, one-job and labeled; wrong returned identity fails closed", async () => {
  const call = (name: string) => new GitHub(policy, "unused", async (url, init) => {
    assert.equal(new URL(String(url)).pathname, "/repos/fixture/private/actions/runners/generate-jitconfig");
    assert.deepEqual(JSON.parse(String(init?.body)), { name: "owned", runner_group_id: 1, labels: [RUNNER_LABEL], work_folder: "_work" });
    return Response.json({ runner: { id: 17, name, labels: [{ name: RUNNER_LABEL }] }, encoded_jit_config: "secret" }, { status: 201 });
  });
  assert.deepEqual(await call("owned").jit("owned", "token"), { id: 17, config: "secret" });
  await assert.rejects(call("someone-else").jit("owned", "token"), /jit-response-uncertain/);
  const generic = new GitHub(policy, "unused", async () => Response.json({ runner: { id: 17, name: "owned",
    labels: [{ name: RUNNER_LABEL }, { name: "self-hosted" }] }, encoded_jit_config: "secret" }, { status: 201 }));
  await assert.rejects(generic.jit("owned", "token"), /jit-response-uncertain/);
});

test("cleanup never deletes a foreign registration and tolerates already-removed runners", async () => {
  let deletes = 0;
  let state = "foreign";
  const github = new GitHub(policy, "unused", async (_url, init) => {
    if (init?.method === "DELETE") { deletes++; return new Response(null, { status: 204 }); }
    if (state === "absent") return new Response(null, { status: 404 });
    return Response.json({ id: 17, name: state });
  });
  await assert.rejects(github.remove(17, "owned", "token"), /identity-mismatch/);
  assert.equal(deletes, 0);
  state = "owned"; await github.remove(17, "owned", "token"); assert.equal(deletes, 1);
  state = "absent"; await github.remove(17, "owned", "token"); assert.equal(deletes, 1);
});

test("upstream errors are bounded codes, not leaked credentials; redirects are never followed", async () => {
  for (const status of [301, 401, 403, 429, 500]) {
    const github = new GitHub(policy, "unused", async (_url, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response("secret-jit-or-token-in-upstream-body", { status });
    });
    await assert.rejects(github.jit("owned", "token"), new RegExp(`^Error: github-${status}$`));
  }
});

test("ambiguous registration recovery enumerates bounded pages and returns exact names only", async () => {
  let calls = 0;
  const github = new GitHub(policy, "unused", async () => {
    calls++; return Response.json({ runners: calls === 1 ? Array.from({ length: 100 }, (_, id) => ({ id: id + 1, name: "other" })) : [{ id: 17, name: "owned" }] });
  });
  assert.equal(await github.find("owned", "token"), 17); assert.equal(calls, 2);
  const unavailable = new GitHub(policy, "unused", async () => Response.json({ runners: Array(100).fill({ name: "other" }) }));
  await assert.rejects(unavailable.find("owned", "token"), /runner-list-limit/);
});
