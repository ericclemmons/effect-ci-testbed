import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { runnerWebhook } from "./runner-webhook.ts";

const secret = "local-runner-fixture-secret";
const request = (event = "workflow_job", body = '{"action":"queued"}', signature?: string) =>
  new Request("https://ci.invalid/webhooks/github", { method: "POST", body, headers: {
    "x-github-event": event,
    "x-hub-signature-256": signature ?? "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
    authorization: "Bearer do-not-forward", cookie: "CF_Authorization=do-not-forward",
    "cf-access-jwt-assertion": "do-not-forward", "x-untrusted-destination": "https://foreign.invalid",
  } });

test("same-App router forwards only the exact signed workflow_job body to the fixed service binding", async () => {
  let calls = 0;
  const response = await runnerWebhook(request(), { GITHUB_WEBHOOK_SECRET: secret, GITHUB_ACTIONS_RUNNER: {
    fetch: async (input: any, init: any) => {
      calls++;
      assert.equal(input, "https://runner.internal/github/webhook");
      assert.equal(init.method, "POST"); assert.equal(init.redirect, "manual");
      assert.equal(init.body, '{"action":"queued"}');
      const headers = new Headers(init.headers);
      assert.deepEqual([...headers.keys()].sort(), ["content-type", "x-github-event", "x-hub-signature-256"]);
      assert.equal(headers.get("x-github-event"), "workflow_job");
      return Response.json({ state: "queued" }, { status: 202 });
    },
  } });
  assert.equal(response?.status, 202); assert.equal(calls, 1);
});

test("check_suite and other existing routes stay untouched, including their unread request body", async () => {
  for (const event of ["check_suite", "push", "ping", "workflow_run"]) {
    const r = request(event);
    assert.equal(await runnerWebhook(r, {}), undefined); assert.equal(r.bodyUsed, false);
  }
  assert.equal(await runnerWebhook(new Request("https://ci.invalid/demo/run", { method: "POST", body: "{}" }), {}), undefined);
});

test("invalid signatures, missing secrets and excessive streamed bytes cannot reach the runner", async () => {
  let calls = 0;
  const env = { GITHUB_WEBHOOK_SECRET: secret, GITHUB_ACTIONS_RUNNER: { fetch: async () => { calls++; return new Response(); } } };
  assert.equal((await runnerWebhook(request("workflow_job", "{}", "sha256=invalid"), env))?.status, 401);
  assert.equal((await runnerWebhook(request(), {}))?.status, 503);
  assert.equal((await runnerWebhook(request("workflow_job", "x".repeat(256 * 1024 + 1)), env))?.status, 503);
  assert.equal(calls, 0);
});

test("optional runner unavailable/disabled does not fall through into ordinary CI or leak upstream errors", async () => {
  assert.equal((await runnerWebhook(request(), { GITHUB_WEBHOOK_SECRET: secret }))?.status, 202);
  const r = await runnerWebhook(request(), { GITHUB_WEBHOOK_SECRET: secret, GITHUB_ACTIONS_RUNNER: {
    fetch: async () => { throw Error("private upstream detail"); },
  } });
  assert.equal(r?.status, 503); assert.doesNotMatch(await r!.text(), /private/);
});
