import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const cache = resolve(root, ".effect-ci/cache/release-flywheel")
const destination = resolve(root, "examples/release-flywheel/proof")
const read = (name: string) => JSON.parse(readFileSync(resolve(cache, `${name}.json`), "utf8"))
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const elapsed = (start: string, end: string) => Date.parse(end) - Date.parse(start)
const [coldId, warmId, releaseId] = process.argv.slice(2)
assert.ok(coldId && warmId, "Usage: report.ts COLD_ID WARM_ID [RELEASE_ID]")
const local = read("local")
const note = read("note")
const build = read("build")
const summarize = (id: string, reused: boolean, release: boolean) => {
  const raw = read(`run-${id}`)
  assert.equal(raw.status, "complete")
  assert.equal(raw.params.revision, local.revision)
  assert.equal(raw.output.revision, local.revision)
  assert.equal(raw.output.checkReused, reused)
  assert.deepEqual(raw.output.identity, note.identity)
  const executed = (step: string) => raw.steps.some((s: any) => s.name === `command:["${step}",1]-1` && s.success === true)
  assert.equal(executed("worker-tests"), !reused, "Native command history must corroborate check execution or reuse")
  assert.equal(executed("build"), true, "Build must execute even when the check is reused")
  assert.ok(raw.steps.every((s: any) => s.success === true), "No failed or pending native step can count as a completed proof")
  if (release) {
    assert.deepEqual(raw.output.build, build)
    assert.ok(raw.output.approvedAt >= raw.output.verifiedAt)
    assert.ok(raw.output.release.startedAt >= raw.output.approvedAt)
    assert.equal(raw.output.release.evidenceSource, "closed-client-http-cohort")
    assert.equal(raw.output.release.wobsVerified, false)
    assert.equal(raw.output.release.releaseCommitted, false)
    assert.deepEqual(raw.output.release.promotions, [10, 25, 75, 100])
    for (const phase of [10, 25, 75, 100]) {
      assert.equal(raw.output.release.observations.filter((o: any) => o.phase === phase).at(-1).status, "advance")
    }
    assert.deepEqual(raw.output.release.restored.versions, [{ version: "156c4427-b574-49e8-a6c9-cf2d034131b3", percentage: 100 }])
    const approval = raw.steps.find((s: any) => s.name === "proof:human-approval-1")
    assert.equal(approval.type, "waitForEvent")
    assert.equal(approval.success, true)
    assert.ok(raw.steps.find((s: any) => s.name === "release:lab-cleanup-1")?.success)
  }
  return { id, workflowVersion: raw.versionId, sourceRevision: raw.params.revision,
    status: raw.status, rawSnapshotDigest: hash(raw), output: raw.output,
    timingsMs: { queue: elapsed(raw.queued, raw.start), workflow: elapsed(raw.start, raw.end),
      queuedToFinished: elapsed(raw.queued, raw.end), verification: raw.output.verifiedAt - raw.output.startedAt,
      evidenceLookup: raw.output.lookups.reduce((sum: number, l: any) => sum + l.elapsedMs, 0),
      testCommandIncludingDispatch: raw.output.executions.find((e: any) => e.step === "worker-tests")?.elapsedMs ?? null,
      buildCommandIncludingDispatch: raw.output.executions.find((e: any) => e.step === "build")?.elapsedMs ?? null,
      approvalWait: raw.output.approvalWaitMs ?? null,
      rolloutIncludingHealthWaits: release ? raw.output.release.finishedAt - raw.output.release.startedAt : null },
    nativeSteps: raw.steps.map((s: any) => ({ name: s.name, type: s.type, start: s.start, end: s.end,
      success: s.success, attempts: s.attempts?.length ?? null, outputDigest: s.output ? hash(s.output) : null })),
  }
}
const manifest = { schema: "effect-ci-release-flywheel-proof-v1", recordedAt: new Date().toISOString(),
  assertionResult: "passed", journeyComplete: Boolean(releaseId), samples: 1,
  host: { sourceRevision: process.env.FLYWHEEL_HOST_REVISION ?? null,
    sourceDigest: hash(readFileSync(resolve(root, "apps/example-runner/src/flywheel-workflow.ts"), "utf8")),
    baselineWorkerVersion: "d7e085a2-3ad9-4642-9b30-39fdbf4d92dc",
    reusedCheckWorkerVersion: "9b05684f-d2b7-42e2-b8cd-3e5339d1a391" },
  local: { ...local, elapsedMs: local.finishedAt - local.startedAt }, upload: read("upload"),
  evidence: { notesRef: "refs/notes/effect-ci-hosted-checks-v1", envelope: note },
  cold: summarize(coldId, false, false), warm: summarize(warmId, true, false),
  ...(releaseId ? { release: summarize(releaseId, true, true) } : {}),
  limitations: { video: null, transcript: null, cpu: null, billedCost: null,
    hardwareAttestation: false, crossPlatformEquivalence: "reviewed fixture only",
    approval: "Human decision relayed by the agent through the authenticated Workflow API",
    coldWarm: "Evidence absent/present; fresh workspace per run. Engine/image caches not controlled.",
    health: "Dedicated demo HTTP cohorts; independent-sample assumption; no ambient traffic or native WOBS proof" },
  retrievalMissesAfterNotePublication: (process.env.FLYWHEEL_MISSES ?? "").split(",").filter(Boolean).map(id => {
    const raw = read(`run-${id}`); assert.equal(raw.output.checkReused, false)
    return { id, rawSnapshotDigest: hash(raw), outcome: "executed tests normally", identity: raw.output.identity,
      noteReads: raw.output.noteReads ?? null }
  }),
}
mkdirSync(destination, { recursive: true })
const name = releaseId ?? warmId
const path = resolve(destination, `${name}.json`)
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" })
console.log(JSON.stringify({ path, journeyComplete: manifest.journeyComplete,
  localMs: manifest.local.elapsedMs, cold: manifest.cold.timingsMs, warm: manifest.warm.timingsMs,
  release: "release" in manifest ? manifest.release?.timingsMs : undefined }, null, 2))
