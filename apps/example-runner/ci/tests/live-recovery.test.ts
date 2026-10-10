import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const owner = process.env.HMD_ABANDON_INSTANCE
const deployment = process.env.HMD_RECOVERY_DEPLOYMENT
const read = (args: string[]) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 }))

test("broker alarm restores an abandoned controller without Workflow cleanup", { skip: !owner || !deployment }, () => {
  const run = read(["workflows", "instances", "get", owner!, "--workflow-name", "effect-ci-probe-release-broker"])
  assert.equal(run.status, "terminated")
  assert.equal(run.params.abandon, true)
  assert.equal(run.rollback, null)
  assert.equal(run.steps.some((item: any) => item.name?.startsWith("release:restore-baseline")), false)
  const claim = JSON.parse(run.steps.find((item: any) => item.name === "release:claim-1").output)
  const promotion = JSON.parse(run.steps.find((item: any) => item.name === "release:promote-10-1").output)
  assert.equal(promotion.deployment.versions.at(-1).percentage, 10)
  assert.ok(Date.parse(run.end) < claim.expiresAt)
  const restored = read(["workers", "deployments", "get", deployment!, "--worker", "effect-ci-hmd-demo"])
  assert.equal(restored.annotations["workers/message"], `effect-ci-release:${owner}:2`)
  assert.deepEqual(restored.versions, claim.previous.map((item: any) => ({ version_id: item.version, percentage: item.percentage })))
  assert.ok(Date.parse(restored.created_on) >= claim.expiresAt)
})
