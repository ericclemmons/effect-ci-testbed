import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { worker, approvalToken, approvalEventType, type WorkerEnvironment } from "./worker.ts"

test("Slack callback verifies the run capability before sending a native Workflow event", async () => {
  let status = "waiting"
  const events: unknown[] = []
  const environment = {
    EFFECT_CI_API_TOKEN: "run-secret", SLACK_SIGNING_SECRET: "slack-secret",
    SLACK_APP_ID: "A1", SLACK_TEAM_ID: "T1", SLACK_CHANNEL_ID: "C1", SLACK_APPROVER_IDS: "U1",
    GITHUB_APP_ID: "app", GITHUB_PRIVATE_KEY: "unused", GITHUB_WEBHOOK_SECRET: "unused",
  }
  const application = worker({ workflow: () => ({ get: async (id: string) => {
    assert.equal(id, "run")

    return { status: async () => ({ status }), sendEvent: async (event: unknown) => { events.push(event) } }
  } }) as unknown as Workflow })
  const capability = await approvalToken(environment.EFFECT_CI_API_TOKEN, "run", "hosted:release")
  const request = (token = capability) => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = new URLSearchParams({ payload: JSON.stringify({
      type: "block_actions", api_app_id: "A1", team: { id: "T1" }, channel: { id: "C1" }, user: { id: "U1" },
      actions: [{ action_id: "approve_release", value: JSON.stringify({ instanceId: "run", requestId: "hosted:release", token }) }],
    }) }).toString()
    const signature = `v0=${createHmac("sha256", environment.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest("hex")}`

    return new Request("https://ci.example/webhooks/slack", { method: "POST", body, headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature } })
  }
  const send = (token?: string) => application.fetch(request(token), environment as WorkerEnvironment)
  assert.match(await (await send("wrong-capability")).text(), /invalid/)
  assert.equal(events.length, 0)
  assert.equal((await send()).status, 200)
  assert.deepEqual(events, [{ type: approvalEventType("hosted:release"), payload: { decision: "approved", actor: "slack:T1:U1" } }])
  status = "complete"
  assert.match(await (await send()).text(), /already finished/)
  assert.equal(events.length, 1)
})
