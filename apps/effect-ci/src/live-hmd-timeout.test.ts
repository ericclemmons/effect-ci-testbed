import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { parseEnv } from "node:util"
import test from "node:test"

const instance = process.env.HMD_SLACK_TIMEOUT_INSTANCE
const secretsFile = process.env.HMD_SLACK_SECRETS_FILE
const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
const command = (...args: string[]) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))

/** Read-only recorded-run proof. Never dispatches, approves, uploads or edits. */
test("live hosted graph timeout updates one card and restores baseline without approval", {
  skip: !instance, timeout: 60_000,
}, async () => {
  const run = command("workflows", "instances", "get", instance!, "--workflow-name", "effect-ci-hmd-review")
  assert.equal(run.status, "errored")
  assert.equal(run.params.intent, "hmd-review-lab")
  assert.match(run.params.revision, /^[a-f0-9]{40}$/)
  const checkpoint = (name: string) => {
    const step = run.steps.find((entry: any) => entry.name === `${name}-1`)
    assert.equal(step?.success, true, name)
    assert.equal(step.output?.includes("[truncated"), false, name)
    return JSON.parse(step.output)
  }
  const initial = checkpoint("notification:hmd-start")
  const image = checkpoint("notification:hmd-image-10")
  const review = checkpoint("notification:hmd-card-10")
  const terminal = checkpoint("notification:hmd-restored")
  assert.deepEqual([initial.sequence, review.sequence, terminal.sequence], [0, 1, 2])
  assert.equal(review.ts, initial.ts)
  assert.equal(terminal.ts, initial.ts)
  assert.equal(image.ok, true)
  assert.match(image.fileId, /^F[A-Z0-9]+$/)
  assert.deepEqual(run.steps.filter((s: any) => s.name.startsWith("notification:hmd-image")).map((s: any) => s.name),
    ["notification:hmd-image-10-1"], "one image checkpoint, no phase/file redispatch")
  const wait = run.steps.find((entry: any) => entry.name === "review:phase-10-1")
  assert.equal(wait.type, "waitForEvent")
  assert.equal(wait.error.name, "WorkflowTimeoutError")
  assert.ok(Date.parse(wait.end) - Date.parse(wait.start) >= 300_000)
  assert.equal(run.steps.some((entry: any) => entry.name === "review:resolve-10-1" || entry.name === "release:promote-25-1"), false)
  const restored = checkpoint("release:restore-baseline")
  assert.equal(restored.status, "rolled-back")
  assert.deepEqual(restored.deployment.versions, [{ version: baseline, percentage: 100 }])
  const latest = command("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo", "--per-page", "1").deployments[0]
  assert.equal(latest.id, restored.deployment.id, "this recorded restoration must still be current")
  assert.deepEqual(latest.versions, [{ version_id: baseline, percentage: 100 }])

  // Optional read-only Slack receipt corroboration. Credentials stay local and
  // never enter logs, native step history or a workspace container.
  if (secretsFile) {
    const env = parseEnv(await readFile(secretsFile, "utf8"))
    assert.ok(env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID && env.SLACK_APP_ID)
    const response = await fetch("https://slack.com/api/conversations.history", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, oldest: initial.ts, latest: initial.ts, inclusive: true, limit: 1 }),
    })
    assert.equal(response.status, 200)
    const history = await response.json() as any
    assert.equal(history.ok, true, "Slack history read failed")
    const message = history.messages.find((entry: any) => entry.ts === initial.ts)
    assert.equal(message?.app_id, env.SLACK_APP_ID)
    assert.match(message.text, /Failed/)
    assert.match(message.text, /uncertain/)
    assert.ok(JSON.stringify(message.blocks).includes(instance!))
    assert.ok(message.blocks.some((block: any) => block.type === "image" && block.slack_file?.id === image.fileId))
    assert.ok(!message.blocks.some((block: any) => block.elements?.some((element: any) => element.action_id === "hmd_approve" || element.action_id === "hmd_reject")))
  }
})
