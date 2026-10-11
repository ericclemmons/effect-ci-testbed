import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import test from "node:test"

const resume = process.env.HMD_REVIEW_RESUME_INSTANCE
const timeout = process.env.HMD_REVIEW_TIMEOUT_INSTANCE
const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
const candidate = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
const command = (...args: string[]) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
const get = (id: string) => command("workflows", "instances", "get", id, "--workflow-name", "effect-ci-example-hmd-review")
const checkpoint = (run: any, name: string) => {
  const step = run.steps.find((entry: any) => entry.name === `${name}-1`)
  assert.equal(step.success, true)
  assert.equal(step.output.includes("[truncated"), false)
  return JSON.parse(step.output)
}
const restoredBaseline = (deployment: any) => {
  assert.deepEqual(deployment.versions, [{ version: baseline, percentage: 100 }])
  const latest = command("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo").deployments[0]
  assert.equal(latest.id, deployment.id, "this recorded run must still own the current lab restoration")
  assert.deepEqual(latest.versions, [{ version_id: baseline, percentage: 100 }])
}

// Read-only: neither creates an instance nor sends an event or deployment mutation.
test("administrative event replay resumes four uncertain phases without claiming human approval", { skip: !resume }, () => {
  const run = get(resume!)
  assert.equal(run.status, "complete")
  const output = run.output
  assert.equal(output.status, "reviewed-all-phases")
  assert.equal(output.releaseCommitted, false)
  assert.equal(output.wobsVerified, false)
  assert.equal(output.evidenceSource, "closed-client-http-cohort")
  assert.deepEqual(output.observations.map((entry: any) => entry.phase), [10, 25, 75, 100])
  const digests = new Set<string>()
  for (const observation of output.observations) {
    assert.equal(observation.owner, resume)
    assert.equal(observation.candidate.version, candidate)
    assert.equal(observation.baseline.version, baseline)
    assert.equal(observation.decision.status, "uncertain")
    assert.equal(observation.basis, "human-risk-acceptance")
    assert.match(observation.approval.reason, /^AUTOMATED LAB ONLY:/)
    assert.ok(observation.approval.acceptedAt < observation.expiresAt)
    assert.ok(observation.chart.startsWith("<svg ") && observation.chart.endsWith("</svg>"))
    assert.equal(observation.chart.includes("[truncated"), false)
    const { owner, phase, baseline: previous, candidate: current, policy, margins, decision, route } = observation
    const digest = createHash("sha256").update(JSON.stringify({ owner, phase, baseline: previous, candidate: current, policy, margins, decision, route })).digest("hex")
    assert.equal(observation.snapshot, digest)
    digests.add(digest)
    const request = checkpoint(run, `review:request-${phase}`)
    assert.equal(request.snapshot, digest)
    assert.equal(request.expiresAt, observation.expiresAt)
    const nativeRequest = run.steps.find((entry: any) => entry.name === `review:request-${phase}-1`)
    assert.ok(Buffer.byteLength(nativeRequest.output) < 1024)
    const wait = run.steps.find((entry: any) => entry.name === `review:phase-${phase}-1`)
    assert.equal(wait.type, "waitForEvent")
    assert.equal(wait.finished, true)
    assert.equal(wait.error, null)
    const resolution = checkpoint(run, `review:resolve-${phase}`)
    assert.equal(resolution.status, "advance")
    assert.equal(resolution.basis, "human-risk-acceptance")
    const promoted = checkpoint(run, `release:promote-${phase}`)
    assert.equal(promoted.deployment.versions.find((version: any) => version.version === candidate).percentage, phase)
    checkpoint(run, `release:verify-after-review-${phase}`)
  }
  assert.equal(digests.size, 4)
  assert.ok(run.steps.every((entry: any) => !entry.name.startsWith("notification:")))
  restoredBaseline(output.restored)
})

test("five-minute review timeout fails closed before25% and restores the prior allocation", { skip: !timeout }, () => {
  const run = get(timeout!)
  assert.equal(run.status, "errored")
  const wait = run.steps.find((entry: any) => entry.name === "review:phase-10-1")
  assert.equal(wait.error.name, "WorkflowTimeoutError")
  assert.ok(Date.parse(wait.end) - Date.parse(wait.start) >= 300_000)
  assert.equal(run.steps.some((entry: any) => entry.name === "review:resolve-10-1" || entry.name === "release:promote-25-1"), false)
  const restored = checkpoint(run, "release:restore-baseline")
  assert.equal(restored.status, "rolled-back")
  assert.deepEqual(restored.deployment.versions, [{ version: baseline, percentage: 100 }])
  // A later successful lab may have restored the same allocation in another deployment.
  const latest = command("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo").deployments[0]
  assert.deepEqual(latest.versions, [{ version_id: baseline, percentage: 100 }])
})
