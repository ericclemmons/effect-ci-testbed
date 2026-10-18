import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { smallChangeWebhook } from "./small-change-webhook.ts";

const secret = "fixture-only", delivery = "11111111-1111-4111-8111-111111111111";
const body = { action: "opened", number: 50, repository: { full_name: "ericclemmons/effect-ci-testbed" }, installation: { id: 165265172 } };
const request = (value: unknown, event = "pull_request", signature?: string) => {
  const text = JSON.stringify(value);
  return new Request("https://ci.invalid/webhooks/github", { method: "POST", body: text, headers: {
    "x-github-event": event, "x-github-delivery": delivery,
    "x-hub-signature-256": signature ?? "sha256=" + createHmac("sha256", secret).update(text).digest("hex"),
  } });
};

test("signed PRs and completed native suites select PR-only work, replay starts nothing new", async () => {
  const ids = new Set<string>(); let starts = 0;
  const workflow: any = {
    get: async (id: string) => { if (!ids.has(id)) throw Error("absent"); return { status: async () => ({ status: "complete" }) }; },
    create: async ({ id, params }: any) => { starts++; ids.add(id); assert.deepEqual(params, { number: 50 }); },
  };
  assert.equal((await smallChangeWebhook(request(body), secret, workflow))?.status, 202);
  await smallChangeWebhook(request(body), secret, workflow);
  assert.equal(starts, 1);
  const suite = request({ ...body, action: "completed", check_suite: { app: { id: 5089816 }, pull_requests: [{ number: 50 }] } }, "check_suite");
  assert.equal((await smallChangeWebhook(suite, secret, workflow))?.status, 202);
  assert.equal(starts, 1); // same fixture delivery
});

test("existing suite execution remains unread; foreign/unsigned events cannot select reviews", async () => {
  const workflow: any = { create: async () => assert.fail("Must not create"), get: async () => assert.fail("Must not inspect") };
  for (const [value, event] of [[{ ...body, action: "requested" }, "check_suite"],
    [{ ...body, installation: { id: 1 } }, "pull_request"], [{ ...body, repository: { full_name: "foreign/repo" } }, "pull_request"],
    [body, "push"], [body, "workflow_job"]] as const) {
    const r = request(value, event);
    assert.equal(await smallChangeWebhook(r, secret, workflow), undefined);
    assert.equal(r.bodyUsed, false);
  }
  assert.equal((await smallChangeWebhook(request(body, "pull_request", "invalid"), secret, workflow))?.status, 401);
  assert.equal((await smallChangeWebhook(request({ ...body, number: -1 }), secret, workflow))?.status, 400);
  assert.equal((await smallChangeWebhook(request("x".repeat(256 * 1024)), secret, workflow))?.status, 503);
});

test("uncertain creation returns an error without retrying a native workflow", async () => {
  let creates = 0;
  const workflow: any = { get: async () => { throw Error("absent"); }, create: async () => { creates++; throw Error("lost private ACK"); } };
  const response = await smallChangeWebhook(request(body), secret, workflow);
  assert.equal(response?.status, 503); assert.equal(creates, 1);
  assert.doesNotMatch(await response!.text(), /private/);
});
