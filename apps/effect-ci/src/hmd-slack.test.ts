import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { hmdSlackInteraction, isHmdSlackBody } from "./hmd-slack.ts"
const env = { SLACK_SIGNING_SECRET: "test-secret", SLACK_APP_ID: "A1", SLACK_TEAM_ID: "T1", SLACK_CHANNEL_ID: "C1", SLACK_APPROVER_IDS: "U1", SLACK_BOT_TOKEN: "test-token" }
const capability = { owner: "run", phase: 10, snapshot: "a".repeat(64), token: "b".repeat(64) }
const block = { type: "block_actions", api_app_id: "A1", team: { id: "T1" }, user: { id: "U1" }, channel: { id: "C1" }, trigger_id: "trigger",
  actions: [{ action_id: "hmd_approve", value: JSON.stringify(capability) }] }
const submission = (reason: string, actor = "slack:T1:U1") => ({ type: "view_submission", api_app_id: "A1", team: { id: "T1" }, user: { id: "U1" },
  view: { callback_id: "hmd_review", private_metadata: JSON.stringify({ capability, decision: "approved", actor }), state: { values: { rationale: { reason: { value: reason } } } } } })
const signed = (payload: unknown, timestamp = String(Math.floor(Date.now() / 1000))) => {
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
  const signature = `v0=${createHmac("sha256", env.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest("hex")}`
  return new Request("https://ci.example/webhooks/slack", { method: "POST", body, headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature } })
}
const forbidden = async (): Promise<never> => { assert.fail("No delivery before authorization") }
test("button opens a private rationale modal; only signed matching submission consumes a decision", async () => {
  let modal: Record<string, any> | undefined
  const decisions: unknown[] = []
  const reviews = { inspect: async (cap: unknown) => { assert.deepEqual(cap, capability); return true },
    submit: async (...args: unknown[]) => { decisions.push(args); return true } }
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, "https://slack.com/api/views.open")
    assert.equal(init?.redirect, "manual")
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token")
    modal = JSON.parse(String(init?.body)); return Response.json({ ok: true })
  }
  assert.equal((await hmdSlackInteraction(signed(block), env, reviews, transport)).status, 200)
  assert.equal(decisions.length, 0)
  assert.equal(modal!.view.blocks[1].element.max_length, 500)
  assert.equal(JSON.parse(modal!.view.private_metadata).actor, "slack:T1:U1")
  assert.equal((await hmdSlackInteraction(signed(submission("Explicit test-only risk acceptance")), env, reviews, forbidden)).status, 200)
  assert.deepEqual(decisions, [[capability, "approved", "Explicit test-only risk acceptance", "slack:T1:U1"]])
})
test("fresh HMAC, pinned app/team/channel and reviewer are required before RPC or modal calls", async () => {
  const reviews = { inspect: forbidden, submit: forbidden }
  for (const request of [new Request("https://ci.example/webhooks/slack", { method: "POST", body: "bad" }), signed(block, "1")]) {
    assert.equal((await hmdSlackInteraction(request, env, reviews, forbidden)).status, 401)
  }
  for (const patch of [{ api_app_id: "A2" }, { team: { id: "T2" } }, { user: { id: "U2" } }, { channel: { id: "C2" } }]) {
    assert.equal((await hmdSlackInteraction(signed({ ...block, ...patch }), env, reviews, forbidden)).status, 403)
  }
  assert.equal((await hmdSlackInteraction(signed(submission("reason", "slack:T1:OTHER")), env, reviews, forbidden)).status, 403)
})
test("stale capability, empty reason, lost modal ack and consumed submission fail without blind retries", async () => {
  const stale = await hmdSlackInteraction(signed(block), env, { inspect: async () => false, submit: forbidden }, forbidden)
  assert.match(await stale.text(), /no longer/)
  for (const reason of [" ", "x".repeat(501)]) {
    const response = await hmdSlackInteraction(signed(submission(reason)), env, { inspect: forbidden, submit: forbidden }, forbidden)
    assert.equal((await response.json() as { response_action: string }).response_action, "errors")
  }
  let calls = 0
  const lost: typeof fetch = async () => { calls++; throw new Error("secret upstream error") }
  assert.equal((await hmdSlackInteraction(signed(block), env, { inspect: async () => true, submit: forbidden }, lost)).status, 400)
  assert.equal(calls, 1)
  const rejected = await hmdSlackInteraction(signed(submission("reason")), env, { inspect: forbidden, submit: async () => false }, forbidden)
  assert.match(await rejected.text(), /No decision was resent/)
  assert.equal(isHmdSlackBody(await signed(block).text()), true)
  assert.equal(isHmdSlackBody(await signed(submission("reason")).text()), true)
  assert.equal(isHmdSlackBody(await signed({ ...block, actions: [{ action_id: "approve_release" }] }).text()), false)
})
