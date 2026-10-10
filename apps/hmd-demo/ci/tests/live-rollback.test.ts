import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { beginRelease, recordHealth, releaseAllocation, type VersionAllocation } from "../../../../packages/cloudflare/src/release-policy.ts"
import { evaluateHealth, type HealthSample } from "../../../../packages/cloudflare/src/health-gate.ts"

const worker = "effect-ci-hmd-demo" // Deliberately cannot target a production Worker.
const origin = `https://${worker}.ericclemmons.workers.dev`
const baselineVersion = "09593237-23b2-4873-bd04-88c8e8488840"
const candidateVersion = "02de9b2e-95d0-49e6-b787-467e25c5a65c"
const cf = process.env.HMD_CF_BIN ?? "cf"
interface Deployment { id: string; versions: Array<{ version_id: string; percentage: number }> }
const command = (...args: string[]): unknown => JSON.parse(execFileSync(cf, args, {
  encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
}))
const current = (): Deployment => {
  const result = command("workers", "deployments", "list", "--worker", worker) as { deployments: Deployment[] }
  assert.ok(result.deployments[0]?.id, "deployment API must return the active deployment")
  return result.deployments[0]!
}
const apiAllocation = (allocation: ReadonlyArray<VersionAllocation>) => allocation.map((item) => ({
  version_id: item.version, percentage: item.percentage,
}))
const deploy = (allocation: ReadonlyArray<VersionAllocation>): Deployment => {
  const result = command("workers", "deployments", "create", "--worker", worker, "--strategy", "percentage",
    "--versions", JSON.stringify(apiAllocation(allocation))) as Deployment
  assert.ok(result.id, "deployment mutation must return its identity")
  return result
}
async function request(url: string): Promise<{ version: string; healthy: boolean }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" })
  assert.ok(response.status === 200 || response.status === 503)
  const result = await response.json() as { version: string; healthy: boolean }
  assert.equal(response.status, result.healthy ? 200 : 503)
  assert.ok([baselineVersion, candidateVersion].includes(result.version), "unexpected version: stop the test")
  return result
}

test("live dedicated target: 10% regression restores the exact previous allocation", {
  skip: process.env.HMD_LIVE !== "1", timeout: 240_000,
}, async () => {
  // Single-operator lab test, not a production concurrency/ownership implementation.
  const before = current()
  assert.deepEqual(before.versions, [{ version_id: baselineVersion, percentage: 100 }])
  const previous = before.versions.map((item) => ({ version: item.version_id, percentage: item.percentage }))
  let state = beginRelease(candidateVersion, previous)
  const from = Date.now()
  for (let i = 0; i < 20; i++) {
    const result = await request(`${origin}/health`)
    assert.equal(result.version, baselineVersion)
    assert.equal(result.healthy, true)
  }
  const baselineEnd = Date.now()
  const baseline: HealthSample = { version: baselineVersion, from, to: baselineEnd,
    completeThrough: baselineEnd, trials: 20, failures: 0, sampling: "unsampled" }
  const preview = await request(`https://${candidateVersion.slice(0, 8)}-${worker}.ericclemmons.workers.dev/health`)
  assert.equal(preview.version, candidateVersion)
  assert.equal(preview.healthy, false)
  assert.equal(current().id, before.id, "another deployment happened before this test; do not mutate")
  const shifted = deploy(releaseAllocation(state))
  let trials = 0
  let failures = 0
  const phaseStartedAt = Date.now()
  try {
    assert.equal(current().id, shifted.id)
    // At most 400 real requests, five at a time. Count only responses attributed to the candidate.
    for (let batch = 0; batch < 80 && trials < 20; batch++) {
      for (const result of await Promise.all(Array.from({ length: 5 }, () => request(`${origin}/health`)))) {
        if (result.version === candidateVersion) { trials++; if (!result.healthy) failures++ }
      }
    }
    const to = Date.now()
    const decision = evaluateHealth(baseline, { version: candidateVersion, from: phaseStartedAt, to,
      completeThrough: to, trials, failures, sampling: "unsampled" }, {
      baselineVersion, candidateVersion, phaseStartedAt, baselineWindow: { from, to: baselineEnd },
      minTrials: 20, maxErrorRate: 0.1, maxIncrease: 0.05, alpha: 0.05, comparisons: 4,
    })
    state = recordHealth(state, decision)
    console.log(JSON.stringify({ directHttpProbe: true, previousDeployment: before.id,
      shiftedDeployment: shifted.id, trials, failures, decision }))
    assert.equal(decision.status, "regression")
    assert.equal(state.status, "rollback")
  } finally {
    // Never overwrite a newer operator's deployment. This check is advisory, not atomic CAS.
    assert.equal(current().id, shifted.id, "ownership changed; refuse to overwrite the newer deployment")
    const restored = deploy(previous)
    const active = current()
    assert.equal(active.id, restored.id)
    assert.deepEqual(active.versions, before.versions)
    console.log(JSON.stringify({ restoredDeployment: restored.id, allocation: active.versions }))
  }
  const healthy = await request(`${origin}/health`)
  assert.equal(healthy.version, baselineVersion)
  assert.equal(healthy.healthy, true)
})
