import assert from "node:assert/strict"
import test from "node:test"
import { hasNotificationChannels, notificationText, sendNotification } from "./notifications.ts"

test("status notifications are independent of approvals and omit command output", () => {
  assert.equal(notificationText({ type: "workflow.started", workflowId: "deploy", environment: "cloudflare", mode: "execute", timestamp: "now" }), "CI deploy: started")
  assert.equal(notificationText({ type: "step.output", workflowId: "deploy", stepId: "release", stream: "stdout", text: "secret", timestamp: "now" }), undefined)
  assert.equal(notificationText({ type: "step.status", workflowId: "deploy", stepId: "format", status: "warning", optional: true, timestamp: "now" }), "CI deploy: format — warning (optional)")
  assert.equal(notificationText({ type: "approval.requested", workflowId: "deploy", stepId: "release", requestId: "review", approval: { title: "Review", summary: "Sensitive release context" }, timestamp: "now" }), "CI deploy: release — waiting for approval")
})

test("Discord confirms delivery and disables mentions; Slack uses plain text", async () => {
  const requests: Array<{ url: string; body: any }> = []
  const transport = (async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)) })

    return new Response(null, { status: 204 })
  }) as typeof fetch
  assert.deepEqual(await sendNotification({ DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token", SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/test" }, "@everyone release complete", transport), { delivered: 2, failed: 0 })
  assert.match(requests[0]!.url, /wait=true/)
  assert.deepEqual(requests[0]!.body.allowed_mentions, { parse: [] })
  assert.equal(requests[1]!.body.blocks[0].text.type, "plain_text")
})

test("delivery failures are isolated per provider and do not throw", async () => {
  const transport = (async (url) => {
    if (String(url).includes("discord")) throw new Error("secret URL")

    return new Response(null, { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await sendNotification({ DISCORD_WEBHOOK_URL: "https://discord.com/test", SLACK_WEBHOOK_URL: "https://hooks.slack.com/test" }, "build failed", transport), { delivered: 1, failed: 1 })
  assert.deepEqual(await sendNotification({}, "no channels", transport), { delivered: 0, failed: 0 })
})

test("Slack app creates then edits the same message without using the webhook", async () => {
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
  const transport = (async (url, options) => {
    requests.push({ url: String(url), headers: new Headers(options?.headers), body: JSON.parse(String(options?.body)) })

    return Response.json({ ok: true, ts: "123.456" })
  }) as typeof fetch
  const channels = { SLACK_BOT_TOKEN: "test-token", SLACK_CHANNEL_ID: "C123", SLACK_WEBHOOK_URL: "https://hooks.slack.com/not-used" }
  assert.equal(hasNotificationChannels(channels), true)
  const started = await sendNotification(channels, "build started", transport)
  assert.equal(started.slackMessageTs, "123.456")
  await sendNotification(channels, "build complete", transport, started.slackMessageTs)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]!.url, "https://slack.com/api/chat.postMessage")
  assert.equal(requests[1]!.url, "https://slack.com/api/chat.update")
  assert.equal(requests[1]!.body.ts, "123.456")
  assert.equal(requests[1]!.body.channel, "C123")
  assert.equal(requests[1]!.headers.get("authorization"), "Bearer test-token")
})

test("Slack HTTP 200 with an API error is not reported as delivered", async () => {
  const transport = (async () => Response.json({ ok: false, error: "not_in_channel" })) as typeof fetch
  const result = await sendNotification({ SLACK_BOT_TOKEN: "test-token", SLACK_CHANNEL_ID: "C123" }, "deploy", transport)
  assert.deepEqual(result, { delivered: 0, failed: 1 })
  assert.equal(hasNotificationChannels({ SLACK_BOT_TOKEN: "test-token" }), false)
})

test("Discord creates then patches the same message and keeps mentions disabled", async () => {
  const requests: Array<{ url: string; method: string | undefined; body: Record<string, unknown> }> = []
  const transport = (async (url, options) => {
    requests.push({ url: String(url), method: options?.method, body: JSON.parse(String(options?.body)) })

    return Response.json({ id: "discord-message" })
  }) as typeof fetch
  const channels = { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token" }
  const first = await sendNotification(channels, "running", transport)
  await sendNotification(channels, "complete", transport, undefined, undefined, first.discordMessageId)
  assert.equal(requests[0]!.method, "POST")
  assert.equal(requests[1]!.method, "PATCH")
  assert.match(requests[1]!.url, /\/messages\/discord-message$/)
  assert.deepEqual(requests[1]!.body.allowed_mentions, { parse: [] })
})

test("opt-in known-message private image validation may retry only the identical rejected update", async () => {
  const bodies: string[] = [], waits: number[] = []
  const result = await sendNotification({ SLACK_BOT_TOKEN: "test-token", SLACK_CHANNEL_ID: "C123" }, "review", async (url, init) => {
    assert.equal(String(url), "https://slack.com/api/chat.update")
    bodies.push(String(init?.body))
    return bodies.length === 1 ? Response.json({ ok: false, error: "invalid_blocks" }) : Response.json({ ok: true, ts: "123.456" })
  }, "123.456", [{ type: "image", slack_file: { id: "F123" }, alt_text: "graph" }], undefined,
  { privateImageValidation: true, wait: async ms => { waits.push(ms) } })
  assert.equal(result.delivered, 1)
  assert.equal(result.slackMessageTs, "123.456")
  assert.equal(result.slackImageValidationRetries, 1)
  assert.deepEqual(waits, [500])
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1])
})

test("image validation exhaustion is bounded; ambiguous delivery, non-image updates and initial posts never retry", async () => {
  for (const mode of ["exhausted", "lost-ack", "http", "malformed", "rejected", "no-image", "initial", "default"]) {
    let calls = 0
    const result = await sendNotification({ SLACK_BOT_TOKEN: "test-token", SLACK_CHANNEL_ID: "C123" }, "review", async () => {
      calls++
      if (mode === "lost-ack") throw Error("secret transport")
      if (mode === "http") return new Response(null, { status: 503 })
      if (mode === "malformed") return Response.json({ ok: true })
      return Response.json({ ok: false, error: mode === "rejected" ? "secret untrusted message" : "invalid_blocks" })
    }, mode === "initial" ? undefined : "123.456", mode === "no-image" ? [] : [{ type: "image", slack_file: { id: "F123" }, alt_text: "graph" }], undefined,
    { privateImageValidation: mode !== "default", wait: async () => {} })
    assert.equal(result.failed, 1, mode)
    assert.equal(calls, mode === "exhausted" ? 4 : 1, mode)
    assert.ok(!JSON.stringify(result).includes("secret"))
  }
})
