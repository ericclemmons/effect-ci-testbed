import assert from "node:assert/strict"
import test from "node:test"
import type { RuntimeEvent } from "@effect-ci-testbed/ci"
import { RunCard } from "./run-card.ts"
import { sendNotification } from "./notifications.ts"

const identity = { instanceId: "test-run", repository: "owner/repo", revision: "abc123", slackApprovalsEnabled: true }
const event = (stepId: string, status: "queued" | "running" | "complete" | "warning", optional = false): RuntimeEvent => ({ type: "step.status", workflowId: "build", stepId, status, optional, timestamp: "now" })

test("thread step status is compact and gains duration or cached provenance in place", () => {
  const card = new RunCard(identity)
  card.update({ ...event("test", "running"), timestamp: "2026-10-23T01:00:00Z" })
  assert.equal(card.render({ onlyStep: "test" }).text, "► test")
  card.update({ ...event("test", "complete"), timestamp: "2026-10-23T01:00:07Z" })
  assert.equal(card.render({ onlyStep: "test" }).text, "✓ test · 7s")
  card.update({ type: "step.status", workflowId: "build", stepId: "install", status: "reused", optional: false,
    timestamp: "2026-10-23T01:00:07Z" })
  assert.equal(card.render({ onlyStep: "install" }).text, "✓ install · (cached)")
})

test("unknown process results have explicit step detail without fabricated output or exit codes", () => {
  const card = new RunCard(identity)
  assert.equal(card.update({ type: "step.command.unavailable", workflowId: "build", stepId: "test",
    stage: "container-execution", timestamp: "now" }), true)
  card.update({ type: "step.status", workflowId: "build", stepId: "test", status: "failed", optional: false, timestamp: "now" })
  const detail = card.render({ onlyStep: "test" })
  assert.ok(detail.text.includes("container-execution"))
  assert.ok(detail.text.includes("Process exit unknown"))
  assert.ok(detail.text.includes("No stdout or stderr was captured"))
  assert.ok(detail.text.includes("do not rerun automatically"))
  assert.ok(!detail.text.includes("exit 1"))
  assert.equal(card.commandLog("test"), undefined)
  assert.ok(!card.render({ statusOnly: true }).text.includes("Process exit unknown"))
  assert.ok(!card.renderDetails().text.includes("Process exit unknown"))
})

test("enrolled failure output stays in its step reply, redacted and bounded, never root or provider snapshot", () => {
  const card = new RunCard(identity, { failedCommandOutput: { redactValues: ["owned-private-value"] } })
  const failure: RuntimeEvent = { type: "step.command.failed", workflowId: "cf-ci-demo", stepId: "test", timestamp: "now",
    diagnostics: { version: 1, stepId: "test", command: "pnpm test", cwd: "/fixture", exitCode: 1,
      output: { stdout: "Expected hello\nReceived goodbye\nowned-private-value\n<!channel>\n" + "x".repeat(6000),
        stderr: "Authorization: Bearer abc-private-token\nassertion failed\n", truncated: true } } }
  assert.equal(card.update(failure), true)
  card.update({ type: "step.status", workflowId: "cf-ci-demo", stepId: "test", status: "failed", optional: false, timestamp: "now" })
  const rendered = card.render({ onlyStep: "test" })
  assert.match(JSON.stringify(rendered), /assertion failed|Received goodbye/)
  assert.match(rendered.text, /exit 1/)
  assert.match(JSON.stringify(rendered), /truncated/)
  assert.doesNotMatch(JSON.stringify(rendered), /owned-private-value|abc-private-token|<\!channel>/)
  assert.ok(JSON.stringify(rendered).length < 12000)
  assert.doesNotMatch(JSON.stringify(card.render({ statusOnly: true })), /assertion failed|Received goodbye/)
  assert.doesNotMatch(JSON.stringify(card.snapshot()), /assertion failed|Received goodbye/)
  const log = card.commandLog("test")!
  assert.match(log, /Received goodbye/)
  assert.doesNotMatch(log, /owned-private-value|abc-private-token|<\!channel>/)
  card.attachCommandLog("test", "invalid")
  assert.equal(card.render({ onlyStep: "test" }).text, rendered.text, "missing upload receipt keeps inline output")
  card.attachCommandLog("test", "F123")
  const compact = card.render({ onlyStep: "test" })
  assert.match(compact.text, /Captured output attached in this thread/)
  assert.match(compact.text, /assertion failed/)
  assert.ok(compact.text.length < 800)
  assert.doesNotMatch(JSON.stringify(card.render({ statusOnly: true })), /Captured output/)
  card.update(event("test", "running"))
  assert.equal(card.commandLog("test"), undefined)
  card.update(failure)
  assert.doesNotMatch(card.render({ onlyStep: "test" }).text, /Captured output attached/, "retry must not reuse an old attachment presentation")
  const closed = new RunCard(identity)
  assert.equal(closed.update(failure), false, "unenrolled hosts must not publish command output")
})

test("parent retains workflow, rotating status and latest evidence; replies contain only their step", () => {
  const card = new RunCard(identity)
  card.update(event("checkout", "complete")); card.update(event("build", "running"))
  card.setHealth({ phase: 25, decision: "uncertain", evidenceSource: "native-wobs" }, "FPRIVATE")
  const root = card.render({ statusOnly: true })
  assert.equal(root.blocks.length, 3)
  assert.equal(root.text, "► build · build · 1 step done")
  assert.doesNotMatch(JSON.stringify(root), /checkout|divider|header/)
  assert.match(JSON.stringify(root), /FPRIVATE/)
  assert.ok(!root.blocks.some(block => block.type === "actions"))
  const detail = card.render({ onlyStep: "build" })
  assert.match(detail.text, /^► build\n/)
  assert.doesNotMatch(detail.text, /checkout|Run:|1\./)
  assert.doesNotMatch(JSON.stringify(detail.blocks), /owner\/repo|Details|header|divider|1\. /)
  assert.match(JSON.stringify(detail.blocks), /FPRIVATE/)
  card.update(event("build", "complete"))
  card.update(event("Release 25%", "running"))
  assert.match(card.render({ statusOnly: true }).text, /^► build · Release 25% · 2 steps done$/)
  card.setHealth({ phase: 75, decision: "uncertain", evidenceSource: "native-wobs" }, "FLATEST")
  card.update(event("Release 25%", "complete"))
  card.update({ type: "workflow.completed", workflowId: "cf-ci-demo", conclusion: "success", timestamp: "now" })
  const final = card.render({ statusOnly: true })
  assert.equal(final.text, "✓ cf-ci-demo · Release 25% · 3 steps done")
  assert.match(JSON.stringify(final.blocks), /FLATEST/)
  assert.doesNotMatch(JSON.stringify(final.blocks), /FPRIVATE|actions|1\. /)
})

test("declared step progress is discrete work, not time or health; unknown steps disable the bar", () => {
  const card = new RunCard(identity, { progressSteps: ["install", "test", "build"] })
  card.update(event("install", "complete")); card.update(event("test", "running"))
  const snapshot = card.snapshot()
  assert.equal(card.render({ statusOnly: true }).text, "► build · test · ▰▱▱ 1/3")
  assert.deepEqual(card.snapshot(), snapshot, "presentation cannot alter semantic status")
  card.update(event("test", "complete")); card.update(event("build", "complete"))
  card.update({ type: "workflow.completed", workflowId: "build", conclusion: "success", timestamp: "now" })
  assert.equal(card.render({ statusOnly: true }).text, "✓ build · build · ▰▰▰ 3/3")
  card.update(event("new dynamic step", "running"))
  assert.doesNotMatch(card.render({ statusOnly: true }).text, /▰|▱|3\/3/)
  assert.throws(() => new RunCard(identity, { progressSteps: ["test", "test"] }))
})

test("each progress segment represents exactly one declared step, without a redundant steps label", () => {
  const ids = Array.from({ length: 15 }, (_, index) => `step-${index + 1}`)
  const card = new RunCard(identity, { progressSteps: ids })
  assert.match(card.render({ statusOnly: true }).text, new RegExp(`${"▱".repeat(15)} 0/15$`))
  for (const id of ids.slice(0, 14)) card.update(event(id, "complete"))
  card.update(event(ids[14]!, "running"))
  const title = card.render({ statusOnly: true }).text
  assert.equal((title.match(/▰/g) ?? []).length, 14)
  assert.equal((title.match(/▱/g) ?? []).length, 1)
  assert.match(title, /14\/15$/)
  assert.doesNotMatch(title, /\bsteps\b/)
  card.update(event(ids[14]!, "complete"))
  assert.match(card.render({ statusOnly: true }).text, new RegExp(`${"▰".repeat(15)} 15/15$`))
})

test("the first reply is a live linked step table, not repeated metadata", () => {
  const card = new RunCard({ ...identity, repository: "<@everyone>", detailsUrl: "javascript:alert(1)" })
  card.update(event("<@everyone>", "running"))
  const frame = card.renderDetails()
  assert.equal(frame.blocks.length, 1); assert.equal(frame.blocks[0]!.type, "table")
  const encoded = JSON.stringify(frame.blocks)
  assert.match(encoded, /raw_text/); assert.doesNotMatch(encoded, /mrkdwn|javascript:|actions/)
  assert.ok(encoded.length < 10000)
  const compact = new RunCard(identity, { progressSteps: ["install", "test", "build"] })
  compact.update(event("install", "complete")); compact.update(event("test", "running"))
  const url = "https://slack.com/archives/C123/p123456789000001"
  const table = JSON.stringify(compact.renderDetails(new Map([["test", url], ["build", "javascript:alert(1)"]])).blocks)
  assert.match(table, /"text":"✓"/); assert.match(table, /"text":"►"/); assert.match(table, /"text":"∗"/)
  assert.doesNotMatch(table, /✓ complete|► running|∗ planned/)
  assert.ok(table.includes(url)); assert.match(table, /"text":"test"/)
  assert.doesNotMatch(table, /Field|Value|Repository|Workflow|javascript:/)
  compact.update(event("test", "complete"))
  assert.match(compact.renderDetails().text, /test: complete/)
  assert.ok(!table.includes('"text":"https://'), "URLs are targets, not visible cells")
  const large = new RunCard(identity)
  for (let i = 0; i < 105; i++) large.update(event(`step-${i}`, "complete"))
  assert.equal((large.renderDetails().blocks[0]!.rows as unknown[]).length, 100)
  assert.match(JSON.stringify(large.renderDetails()), /6 more steps/)
})

test("the step table shows only selected actions with cached or measured time", () => {
  const card = new RunCard(identity, { progressSteps: ["build", "publish preview"] })
  card.update({ type: "step.status", workflowId: "build", stepId: "build", status: "reused", optional: false, timestamp: "2026-10-23T00:00:00Z" })
  card.update({ ...event("publish preview", "running"), timestamp: "2026-10-23T00:00:01Z" })
  card.update({ ...event("publish preview", "complete"), timestamp: "2026-10-23T00:00:04Z" })
  const table = card.renderDetails().blocks[0]!.rows as Array<Array<{ text: string }>>
  assert.deepEqual(table[0]!.map(c => c.text), ["Step", "Status", "Time"])
  assert.deepEqual(table[1]!.map(c => c.text), ["build", "✓", "(cached)"])
  assert.deepEqual(table[2]!.map(c => c.text), ["publish preview", "✓", "3s"])
  assert.equal(table.length, 3)
  assert.doesNotMatch(card.renderDetails().text, /checkout|install|lint|test/)
  assert.match(card.render({ statusOnly: true }).text, /2\/2$/)
})

test("waiting and failure retain explicit state; successful parallel work retains the last completed step", () => {
  const card = new RunCard(identity)
  card.update(event("build", "running")); card.update(event("test", "complete")); card.update(event("build", "complete"))
  card.update({ type: "workflow.completed", workflowId: "demo", conclusion: "success", timestamp: "now" })
  assert.match(card.render({ statusOnly: true }).text, /^✓ demo · build/)
  assert.doesNotMatch(card.render({ statusOnly: true }).text, /Passed/)
  card.update({ type: "approval.requested", workflowId: "demo", stepId: "Release 10%", requestId: "review",
    approval: { title: "Review", summary: "Uncertain data" }, timestamp: "now" })
  assert.match(card.render({ statusOnly: true }).text, /^∗ demo · Release 10% · Awaiting review/)
  card.update({ type: "approval.resolved", workflowId: "demo", stepId: "Release 10%", requestId: "review", decision: "rejected", timestamp: "now" })
  assert.match(card.render({ statusOnly: true }).text, /^✗ demo · Release 10%/)
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
  assert.ok(blocks.includes("|Dashboard>"))
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
  assert.ok(blocks.includes("|Dashboard>"))
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

test("the compact parent retains the latest host-owned preview link after completion", () => {
  const card = new RunCard(identity)
  for (const url of ["http://example.com", "javascript:alert(1)", "https://user:secret@example.com"])
    assert.throws(() => card.setResultLink("Open preview", url))
  card.setResultLink("Open preview", "https://example.com/r/checked/index.html")
  card.update({ type: "workflow.completed", workflowId: "demo", conclusion: "success", timestamp: "now" })
  const frame = card.render({ statusOnly: true })
  assert.ok(JSON.stringify(frame.blocks).includes("https://example.com/r/checked/index.html|Preview"))
  assert.equal(frame.blocks.filter(block => block.type === "section").length, 1)
  assert.match(JSON.stringify(frame.blocks.find(block => block.type === "context")), /Preview/)
})
