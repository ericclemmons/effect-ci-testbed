import assert from "node:assert/strict"
import test from "node:test"
import type { RuntimeEvent } from "@effect-ci-testbed/ci"
import { RunCard } from "./run-card.ts"
import { sendNotification } from "./notifications.ts"

const identity = { instanceId: "test-run", repository: "owner/repo", revision: "abc123", slackApprovalsEnabled: true }
const event = (stepId: string, status: "queued" | "running" | "complete" | "warning", optional = false): RuntimeEvent => ({ type: "step.status", workflowId: "build", stepId, status, optional, timestamp: "now" })

test("checklist keeps all checks and orders prerequisites before dependents", () => {
  const card = new RunCard(identity)
  card.update(event("build", "queued"))
  card.update({ type: "dependency.added", workflowId: "build", stepId: "build", dependency: "install", timestamp: "now" })
  card.update(event("install", "complete"))
  card.update(event("build", "running"))
  card.update(event("format", "warning", true))
  const rendered = card.render()

  assert.ok(rendered.text.indexOf("install") < rendered.text.indexOf("build — running"))
  assert.match(rendered.text, /✅ install\n/)
  assert.ok(!rendered.text.includes("— complete"))
  assert.match(rendered.text, /▶️ build — running/)
  assert.match(rendered.text, /⚠️ format — warning \(optional\)/)
  assert.equal(rendered.blocks[0]!.type, "header")
})

test("approval lives in the same card and its button disappears after resolution", () => {
  const card = new RunCard(identity)
  card.update(event("build", "complete"))
  card.update({ type: "approval.requested", workflowId: "release", stepId: "deploy", requestId: "review", approval: { title: "Review release", summary: "Echo only" }, timestamp: "now" })
  card.setReviewUrl("https://example.com/runs/test-run/approvals/review?token=capability")
  assert.match(card.render().text, /⏳ Waiting for approval/)
  const buttons = JSON.stringify(card.render().blocks)
  assert.ok(buttons.includes("approve_release"))
  assert.ok(buttons.includes("reject_release"))
  assert.ok(!buttons.includes("Review release\",\""))
  assert.match(card.render().text, /✅ build\n/)
  card.update({ type: "approval.resolved", workflowId: "release", stepId: "deploy", requestId: "review", decision: "approved", timestamp: "now" })
  assert.equal(card.render().blocks.some((block) => block.type === "actions"), false)
  assert.match(card.render().text, /✅ deploy — approved/)
})

test("progress, approval, and final result edit one Slack message", async () => {
  const card = new RunCard(identity)
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const transport = (async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)) })

    return Response.json({ ok: true, ts: "123.456" })
  }) as typeof fetch
  let ts: string | undefined
  const events: Array<RuntimeEvent> = [
    event("lint", "running"), event("lint", "complete"),
    { type: "approval.requested", workflowId: "build", stepId: "release", requestId: "review", approval: { title: "Review", summary: "Echo only" }, timestamp: "now" },
    { type: "workflow.completed", workflowId: "build", conclusion: "success", timestamp: "now" },
  ]
  for (const update of events) {
    card.update(update)
    const rendered = card.render()
    const result = await sendNotification({ SLACK_BOT_TOKEN: "test", SLACK_CHANNEL_ID: "C123" }, rendered.text, transport, ts, rendered.blocks)
    ts = result.slackMessageTs
  }
  assert.equal(requests.filter((request) => request.url.endsWith("chat.postMessage")).length, 1)
  assert.equal(requests.filter((request) => request.url.endsWith("chat.update")).length, 3)
  assert.ok(requests.slice(1).every((request) => request.body.ts === "123.456"))
  assert.match(JSON.stringify(requests.at(-1)!.body.blocks), /✅ Passed/)
})

test("command output and Slack mention syntax never enter the checklist", () => {
  const card = new RunCard(identity)
  assert.equal(card.update({ type: "step.output", workflowId: "build", stepId: "lint", stream: "stdout", text: "secret", timestamp: "now" }), false)
  card.update(event("<@everyone>", "running"))
  const blocks = JSON.stringify(card.render().blocks)

  assert.ok(!blocks.includes("secret"))
  assert.ok(blocks.includes("&lt;@everyone&gt;"))
})

test("unconfigured approval callbacks never expose broken approval buttons", () => {
  const card = new RunCard({ ...identity, slackApprovalsEnabled: false, detailsUrl: "https://dash.cloudflare.com/workflow/instance/test-run" })
  card.update({ type: "approval.requested", workflowId: "release", stepId: "deploy", requestId: "review", approval: { title: "Review release", summary: "Echo only" }, timestamp: "now" })
  card.setReviewUrl("https://example.com/runs/test-run/approvals/review?token=capability")
  const blocks = JSON.stringify(card.render().blocks)
  assert.ok(!blocks.includes("approve_release"))
  assert.ok(blocks.includes("|Details>"))
  assert.ok(!card.render().text.includes("capability"))
})

test("queued checks use hourglasses instead of blank boxes", () => {
  const card = new RunCard(identity)
  card.update(event("build", "queued"))
  assert.match(card.render().text, /⏳ build — queued/)
  assert.ok(!JSON.stringify(card.render().blocks).includes("⬜"))
})

test("source context links repository, short commit and details without redundant run footer", () => {
  const revision = "b1fe59642e365a502da90244e01d3c6eb45fd5b4"
  const card = new RunCard({ ...identity, repository: "https://github.com/owner/repo.git", revision,
    detailsUrl: "https://dash.cloudflare.com/workflow/instance/test-run" })
  const blocks = JSON.stringify(card.render().blocks)
  assert.ok(blocks.includes(`<https://github.com/owner/repo|owner/repo>@<https://github.com/owner/repo/commit/${revision}|b1fe596>`))
  assert.ok(blocks.includes("|Details>"))
  assert.ok(!blocks.includes("Revision:"))
  assert.ok(!blocks.includes("View Workflow"))
  assert.ok(!blocks.includes("Cloudflare Workflow"))
  assert.ok(!blocks.includes('"actions"'))
})

test("source context rejects unsafe links and escapes source mention syntax", () => {
  const card = new RunCard({ ...identity, repository: "<@everyone>", revision: "<@channel>", detailsUrl: "javascript:alert(1)" })
  const blocks = JSON.stringify(card.render().blocks)
  assert.ok(blocks.includes("&lt;@everyone&gt;"))
  assert.ok(blocks.includes("&lt;@channel&gt;"))
  assert.ok(!blocks.includes("javascript:"))
  assert.ok(!blocks.includes("|Details>"))
})
