import assert from "node:assert/strict"
import test from "node:test"
import type { RuntimeEvent } from "@effect-ci-testbed/ci"
import { RunCard } from "./run-card.ts"
import { sendNotification } from "./notifications.ts"

const identity = { instanceId: "test-run", repository: "owner/repo", revision: "abc123", slackApprovalsEnabled: true }
const event = (stepId: string, status: "queued" | "running" | "complete" | "warning", optional = false): RuntimeEvent => ({ type: "step.status", workflowId: "build", stepId, status, optional, timestamp: "now" })

test("parent retains workflow, rotating status and latest evidence; replies contain only their step", () => {
  const card = new RunCard(identity)
  card.update(event("checkout", "complete")); card.update(event("build", "running"))
  card.setHealth({ phase: 25, decision: "uncertain", evidenceSource: "native-wobs" }, "FPRIVATE")
  const root = card.render({ statusOnly: true })
  assert.equal(root.blocks.length, 3)
  assert.match(root.text, /^build · ▶️ Running · build$/)
  assert.doesNotMatch(JSON.stringify(root), /checkout|divider|header/)
  assert.match(JSON.stringify(root), /FPRIVATE/)
  assert.ok(!root.blocks.some(block => block.type === "actions"))
  const detail = card.render({ onlyStep: "build" })
  assert.match(detail.text, /^▶️ build — running/)
  assert.doesNotMatch(detail.text, /checkout|Run:|1\./)
  assert.doesNotMatch(JSON.stringify(detail.blocks), /owner\/repo|Details|header|divider|1\. /)
  assert.match(JSON.stringify(detail.blocks), /FPRIVATE/)
  card.update(event("build", "complete"))
  card.update(event("Release 25%", "running"))
  assert.match(card.render({ statusOnly: true }).text, /Running · Release 25%$/)
  card.setHealth({ phase: 75, decision: "uncertain", evidenceSource: "native-wobs" }, "FLATEST")
  card.update({ type: "workflow.completed", workflowId: "cf-ci-demo", conclusion: "success", timestamp: "now" })
  const final = card.render({ statusOnly: true })
  assert.equal(final.text, "cf-ci-demo · ✅ Passed")
  assert.match(JSON.stringify(final.blocks), /FLATEST/)
  assert.doesNotMatch(JSON.stringify(final.blocks), /FPRIVATE|actions|1\. /)
})

test("reverted presentation omits skipped checks without deleting semantic history", () => {
  const card = new RunCard({ instanceId: "rollback", repository: "owner/repo", revision: "abcdef123" })
  for (const [stepId, status] of [["10%", "failed"], ["25%", "skipped"], ["75%", "skipped"], ["Restore previous version", "complete"]] as const) {
    card.update({ type: "step.status", workflowId: "release", stepId, status, optional: false, timestamp: "now" })
  }
  card.update({ type: "workflow.completed", workflowId: "release", conclusion: "failure", timestamp: "now" })
  card.setHealth({phase:10,decision:"regression",evidenceSource:"closed-client-http-cohort"},"F1")
  const before = card.snapshot()
  const reverted = card.render({hideSkipped:true,rollbackStep:"Restore previous version"})
  assert.match(reverted.text,/^↩️ Rolled back/)
  assert.match(reverted.text,/↩️ Restore previous version/)
  assert.ok(!reverted.text.includes("✅ Restore previous version"))
  assert.match(reverted.text,/10% — failed/)
  assert.match(reverted.text,/Restore previous version/)
  assert.match(reverted.text,/regression/)
  assert.ok(!JSON.stringify(reverted).includes("skipped"))
  assert.ok(!JSON.stringify(reverted).includes("25%"))
  assert.ok(reverted.blocks.some(b=>b.type==="image"))
  assert.deepEqual(card.snapshot(),before)
  assert.equal(before.checks.filter(check=>check.status==="skipped").length,2)
  assert.match(card.render().text,/25% — skipped/,"ordinary cards preserve their default presentation")
})

test("restoration is not release success, and failed recovery never claims rollback", () => {
  const card = new RunCard(identity)
  card.update(event("restore", "complete"))
  card.update({type:"workflow.completed",workflowId:"demo",conclusion:"success",timestamp:"now"})
  assert.match(card.render({rollbackStep:"restore"}).text,/^↩️ Previous version restored/)
  assert.ok(!card.render({rollbackStep:"restore"}).text.includes("Passed"))
  card.update({type:"step.status",workflowId:"demo",stepId:"restore",status:"failed",optional:false,timestamp:"now"})
  card.update({type:"workflow.completed",workflowId:"demo",conclusion:"failure",timestamp:"now"})
  assert.match(card.render({rollbackStep:"restore"}).text,/^❌ Failed/)
  assert.ok(!card.render({rollbackStep:"restore"}).text.includes("Rolled back"))
})

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

test("numbered steps retain a nested quoted host-safe failure and restoration is distinct", () => {
  const card = new RunCard(identity)
  card.update(event("10%", "complete"))
  card.setFailure("75%", "Release API request failed (transport): could not connect to Cloudflare.")
  card.update(event("Restore previous version", "complete"))
  card.update({ type: "workflow.completed", workflowId: "demo", conclusion: "failure", timestamp: "now" })
  const frame = card.render({ rollbackStep: "Restore previous version" })
  assert.match(frame.text, /1\. ✅ 10%\n2\. ❌ 75% — failed\n   > Release API request failed \(transport\)/)
  assert.match(frame.text, /3\. ↩️ Restore previous version/)
  assert.ok(JSON.stringify(frame.blocks).includes("\\n   > Release API request failed"))
  assert.equal(card.snapshot().checks.find(check => check.id === "75%")?.failureReason,
    "Release API request failed (transport): could not connect to Cloudflare.")
  card.update(event("75%", "running"))
  assert.equal(card.snapshot().checks.find(check => check.id === "75%")?.failureReason, undefined)
})

test("minimal root uses a live title and only decision content, never the checklist, image or diagnostics", () => {
  const card = new RunCard(identity)
  card.update(event("10%", "complete"))
  card.update(event("25%", "running"))
  card.setHealth({ phase: 25, decision: "uncertain", evidenceSource: "native-wobs" }, "FPRIVATE")
  let frame = card.render({ minimal: true })
  assert.equal(frame.blocks.length, 2)
  assert.match(frame.text, /Running · 25%/)
  assert.doesNotMatch(JSON.stringify(frame), /FPRIVATE|10%|uncertain/)
  card.update({ type: "approval.requested", workflowId: "demo", stepId: "25%", requestId: "review",
    approval: { title: "Progress?", summary: "Auto-progress at 12:00 UTC" }, timestamp: "now" })
  card.setReviewUrl("https://example.com/runs/test-run/approvals/review?token=capability")
  frame = card.render({ minimal: true })
  assert.ok(JSON.stringify(frame).includes("Auto-progress at 12:00 UTC"))
  assert.ok(frame.blocks.some(block => block.type === "actions"))
  card.update({ type: "approval.resolved", workflowId: "demo", stepId: "25%", requestId: "review", decision: "approved", timestamp: "now" })
  card.setFailure("75%", "Release API request failed (transport)")
  card.update(event("restore", "complete"))
  card.update({ type: "workflow.completed", workflowId: "demo", conclusion: "failure", timestamp: "now" })
  frame = card.render({ minimal: true, rollbackStep: "restore" })
  assert.equal(frame.blocks.length, 2)
  assert.match(frame.text, /Rolled back · 75%/)
  assert.doesNotMatch(JSON.stringify(frame), /transport|capability|FPRIVATE/)
  assert.match(card.render().text, /   > Release API request failed/)
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
