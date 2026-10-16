import assert from "node:assert/strict"
import test from "node:test"
import { RunCard, type RunHealth } from "./run-card.ts"
import { sendNotification } from "./notifications.ts"

test("health graphs replace in the existing live CI card while preserving checks and inline approval", async () => {
  const card = new RunCard({ instanceId: "run", repository: "owner/repo", revision: "abcdef123",
    slackApprovalsEnabled: true })
  card.update({ type: "step.status", workflowId: "ci", stepId: "build", status: "complete", optional: false, timestamp: "now" })
  card.update({ type: "approval.requested", workflowId: "ci", stepId: "release", requestId: "review",
    approval: { title: "Review release risk", summary: "Uncertain evidence requires a human decision" }, timestamp: "now" })
  card.setReviewUrl("https://ci.example/runs/run/approvals/review?token=capability")
  const requests: Array<{ url: string; body: any }> = []
  const transport = (async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)) })
    return Response.json({ ok: true, ts: "one.message" })
  }) as typeof fetch
  const channels = { SLACK_BOT_TOKEN: "test", SLACK_CHANNEL_ID: "C123" }
  card.setHealth({ phase: 10, decision: "uncertain", evidenceSource: "closed-client-http-cohort" }, "F123")
  const first = card.render()
  const receipt = await sendNotification(channels, first.text, transport, undefined, first.blocks)
  card.setHealth({ phase: 25, decision: "uncertain", evidenceSource: "closed-client-http-cohort" }, "F456")
  const next = card.render()
  await sendNotification(channels, next.text, transport, receipt.slackMessageTs, next.blocks)
  assert.equal(requests[0]!.url, "https://slack.com/api/chat.postMessage")
  assert.equal(requests[1]!.url, "https://slack.com/api/chat.update")
  assert.equal(requests[1]!.body.ts, "one.message")
  assert.equal(next.blocks.filter(block => block.type === "image").length, 1)
  assert.deepEqual(next.blocks.find(block => block.type === "image")!.slack_file, { id: "F456" })
  assert.ok(JSON.stringify(next.blocks).includes("✅ build"))
  assert.ok(next.text.includes("closed-client-http-cohort"))
  assert.equal(next.blocks.some(block => (block.text as any)?.text?.startsWith("Release 25%")), false, "image replaces redundant health text")
  assert.ok(JSON.stringify(next.blocks).includes("approve_release"))
  assert.equal(card.snapshot().phase, "waiting")
  assert.equal(card.snapshot().health!.decision, "uncertain")
  assert.equal(JSON.stringify(card.snapshot()).includes("capability"), false)
  assert.equal(JSON.stringify(card.snapshot()).includes("F456"), false)
})

test("health presentation copies input, excludes provider receipts and rejects public image URLs", () => {
  const card = new RunCard({ instanceId: "run", repository: "owner/repo", revision: "abcdef123" })
  const health = { phase: 10, decision: "uncertain", evidenceSource: "native-wobs" } as RunHealth
  card.setHealth(health, "F123")
  const snapshot = card.snapshot()
  Object.assign(health, { decision: "advance" })
  assert.equal(snapshot.health!.decision, "uncertain")
  assert.equal(Object.isFrozen(snapshot.health), true)
  assert.throws(() => card.setHealth(health, "https://public.example/chart.png"))
  assert.throws(() => card.setHealth({ ...health, phase: 50 } as unknown as RunHealth))
})

test("a missing new chart retains only the parent's last valid frame, explicitly labeled as older evidence", () => {
  const card = new RunCard({ instanceId: "owned-run", repository: "owner/repo", revision: "abcdef123" })
  card.setHealth({ phase: 75, decision: "uncertain", evidenceSource: "closed-client-http-cohort" }, "FLAST75")
  card.setHealth({ phase: 100, decision: "uncertain", evidenceSource: "closed-client-http-cohort" })
  const parent = card.render({ statusOnly: true })
  assert.deepEqual(parent.blocks.find(b => b.type === "image")?.slack_file, { id: "FLAST75" })
  assert.match(String(parent.blocks.find(b => b.type === "image")?.alt_text), /75%/)
  assert.match(JSON.stringify(parent.blocks), /Release 100%.*chart unavailable.*last chart: 75%/)
  assert.equal(card.render({ onlyStep: "Release 100%" }).blocks.some(b => b.type === "image"), false,
    "An older phase image must not impersonate this review's current snapshot")
  assert.equal(card.snapshot().health?.phase, 100)
  assert.ok(!JSON.stringify(card.snapshot()).includes("FLAST75"))
  card.setHealth({ phase: 100, decision: "uncertain", evidenceSource: "closed-client-http-cohort" }, "FNEW100")
  assert.deepEqual(card.render({ statusOnly: true }).blocks.find(b => b.type === "image")?.slack_file, { id: "FNEW100" })
  assert.ok(!JSON.stringify(card.render({ statusOnly: true })).includes("last chart:"))
  const other = new RunCard({ instanceId: "other-run", repository: "owner/repo", revision: "abcdef123" })
  other.setHealth({ phase: 100, decision: "uncertain", evidenceSource: "closed-client-http-cohort" })
  assert.equal(other.render({ statusOnly: true }).blocks.some(b => b.type === "image"), false)
})
