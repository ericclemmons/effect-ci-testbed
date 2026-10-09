import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { slackInteraction, verifySlackSignature, type SlackDecision } from "./slack-interactions.ts"

const environment = { SLACK_SIGNING_SECRET: "test-secret", SLACK_APP_ID: "A1", SLACK_TEAM_ID: "T1", SLACK_CHANNEL_ID: "C1", SLACK_APPROVER_IDS: "U1" }
const payload = { type: "block_actions", api_app_id: "A1", team: { id: "T1" }, channel: { id: "C1" }, user: { id: "U1" }, actions: [{ action_id: "approve_release", value: JSON.stringify({ instanceId: "run", requestId: "release", token: "capability" }) }] }
const signed = (value: unknown = payload, timestamp = String(Math.floor(Date.now() / 1000))) => {
  const body = new URLSearchParams({ payload: JSON.stringify(value) }).toString()
  const signature = `v0=${createHmac("sha256", environment.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest("hex")}`

  return new Request("https://ci.example/webhooks/slack", { method: "POST", body, headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature } })
}

test("fresh signed Slack approvals need no browser Origin", async () => {
  const decisions: SlackDecision[] = []
  for (const action_id of ["approve_release", "reject_release"]) {
    const response = await slackInteraction(signed({ ...payload, actions: [{ ...payload.actions[0], action_id }] }), environment, async (decision) => { decisions.push(decision); return true })
    assert.equal(response.status, 200)
  }
  assert.deepEqual(decisions.map(({ decision, actor }) => ({ decision, actor })), [{ decision: "approved", actor: "slack:T1:U1" }, { decision: "rejected", actor: "slack:T1:U1" }])
})

test("bad signatures and expired callbacks fail before parsing or delivery", async () => {
  for (const request of [new Request("https://ci.example/webhooks/slack", { method: "POST", body: "malformed" }), signed(payload, "1")]) {
    assert.equal((await slackInteraction(request, environment, async () => { assert.fail("must not deliver"); return true })).status, 401)
  }
  const request = signed()
  assert.equal(await verifySlackSignature(environment.SLACK_SIGNING_SECRET, `${await request.text()}tampered`, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature")), false)
})

test("reviewer and workspace/channel/app restrictions fail closed", async () => {
  for (const override of [{ api_app_id: "A2" }, { team: { id: "T2" } }, { channel: { id: "C2" } }, { user: { id: "U2" } }]) {
    const response = await slackInteraction(signed({ ...payload, ...override }), environment, async () => { assert.fail("must not deliver"); return true })
    assert.ok(response.status === 403 || (await response.text()).includes("not an authorized"))
  }
  const { SLACK_APPROVER_IDS: _reviewers, ...unconfigured } = environment
  assert.equal((await slackInteraction(signed(), unconfigured, async () => true)).status, 503)
})

test("navigation acknowledgements never approve; invalid capabilities report failure", async () => {
  assert.equal((await slackInteraction(signed({ ...payload, actions: [{ action_id: "view_workflow" }] }), environment, async () => { assert.fail("must not deliver"); return true })).status, 200)
  assert.match(await (await slackInteraction(signed(), environment, async () => false)).text(), /invalid or the run has already finished/)
})
