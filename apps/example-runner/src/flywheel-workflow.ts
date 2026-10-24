import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as Effect from "effect/Effect"
import { hostedCheckCache } from "../../../packages/cloudflare/src/check-cache.ts"
import { evaluateHealth } from "../../../packages/cloudflare/src/health-gate.ts"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"
import workflow from "../../../examples/release-flywheel/.cloudflare/ci/workflow.ts"
import { identifyFlywheel, fixtureRoot, repository, command, runtimeCommand, policyDigest, verifyBuild, type BuildReceipt } from "./flywheel-identity.ts"
import trust from "./flywheel-trust.ts"
import { probeBatch, cohortSample, type ProbeBatch } from "./hmd-cohort.ts"

const baseline = "156c4427-b574-49e8-a6c9-cf2d034131b3"
const origin = "https://effect-ci-hmd-demo.ericclemmons.workers.dev"
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" } as const
type Parameters = { revision: string; mode: "verify" | "release"; build?: BuildReceipt }
type Broker = Pick<ReleaseManager, "begin" | "promote" | "rollback" | "renew">

/** Authenticated Cloudflare API only; no HTTP or notification approval endpoint. */
export class FlywheelWorkflow extends WorkflowEntrypoint<{ RELEASE_MANAGER: Broker }> {
  override async run(event: Readonly<WorkflowEvent<Parameters>>, step: WorkflowStep) {
    const { revision, mode, build } = event.payload
    if (!/^[a-f0-9]{40}$/.test(revision) || !["verify", "release"].includes(mode)) throw new NonRetryableError("Invalid proof parameters")
    const startedAt = Date.now()
    const runner = Cloudflare.makeRunner({
      binding: (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace }).WorkspaceContainer,
      repository, revision, root: fixtureRoot, workspaceId: event.instanceId, step,
      reuseWorkspace: false, container: { image: "workspace", instance: "standard-1" },
    })
    const publicKey = await crypto.subtle.importKey("jwk", trust.publicKey, "Ed25519", false, ["verify"])
    const executions: Array<{ step: string; command: string; elapsedMs: number }> = []
    const lookups: Array<{ hit: boolean; elapsedMs: number }> = []
    let measuredIdentity: Awaited<ReturnType<typeof identifyFlywheel>>
    const checkCache = hostedCheckCache({
      reader: { repository: "ericclemmons/effect-ci-testbed", request: (url, init) => fetch(url, {
        ...init, headers: { ...init.headers, "user-agent": "effect-ci-release-flywheel" }, redirect: "manual",
      }) },
      enrollments: [{ keyId: trust.keyId, publicKey, repository,
        checks: [{ workflowId: "release-flywheel", stepId: "worker-tests", command, policyDigest: await policyDigest() }] }],
      identify: async request => {
        measuredIdentity = await identifyFlywheel(request,
          path => Effect.runPromise(runner.fileSystem.readFile(request.workspace, path, "proof-identity")),
          async () => (await Effect.runPromise(runner.executor.execute({ command: runtimeCommand,
            workspace: request.workspace, stepId: "proof-runtime", workflowId: request.workflowId,
            options: {}, onOutput() {} }))).stdout, trust.sourceDigest)
        return measuredIdentity
      },
    })
    const result = await CI.runPromise(workflow, {
      event: { type: "workflow_dispatch", revision, source: { kind: "git", repository, revision } },
      source: runner.source, workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence,
      // Keep source preparation and host identity measurements as native steps;
      // none of these actions has a retry policy requiring a native action body.
      output: "silent",
      executor: { handlesStepOptions: true, execute: request => Effect.gen(function* () {
        const start = Date.now()
        const result = yield* runner.executor.execute(request)
        executions.push({ step: request.stepId, command: request.command, elapsedMs: Date.now() - start })
        return result
      }) },
      checkCache: { ...checkCache, lookup: request => Effect.gen(function* () {
        const start = Date.now()
        const hit = yield* checkCache.lookup(request)
        lookups.push({ hit, elapsedMs: Date.now() - start })
        return hit
      }) },
    })
    const verification = await step.do("proof:verification", once, async () => ({
      revision, mode, startedAt, verifiedAt: Date.now(), executions, lookups, identity: measuredIdentity ?? null,
      nodes: result.plan.nodes.map(node => ({ id: node.id, status: node.status })),
      checkReused: result.plan.nodes.find(node => node.id === "worker-tests")?.status === "verified",
    }))
    if (mode === "verify") return verification
    const candidateModule = await Effect.runPromise(runner.fileSystem.readFile(result.value as CI.Workspace, "candidate.mjs", "proof-artifact"))
    if (!build || !candidateModule || !await verifyBuild(build, revision, candidateModule, publicKey)) {
      throw new NonRetryableError("Candidate is not bound to the tested module by an enrolled build receipt")
    }
    const requestId = await step.do("proof:approval-request", once, async () => ({
      revision, candidate: build.version, moduleDigest: build.moduleDigest, requestedAt: Date.now(),
      target: "effect-ci-hmd-demo", phases: [10, 25, 75, 100], cleanup: "restore previous allocation",
    }))
    // Native authenticated events only. No automatic or fabricated human decision.
    const approval = await step.waitForEvent<{ approved: boolean; revision: string; candidate: string }>(
      "proof:human-approval", { type: "flywheel-approval", timeout: "24 hours" })
    if (approval.payload?.approved !== true || approval.payload.revision !== revision || approval.payload.candidate !== build.version) {
      throw new NonRetryableError("Release rejected or approval identity mismatch")
    }
    const approvedAt = await step.do("proof:approved", once, async () => Date.now())
    const release = await runFlywheelRelease(event.instanceId, step, this.env.RELEASE_MANAGER, build.version)
    return { ...verification, approvalWaitMs: approvedAt - requestId.requestedAt,
      approvedAt, finishedAt: Date.now(), build, release }
  }
}

/** Real version-attributed HTTP cohorts; existing conservative health policy, no inferred WOBS completeness. */
export async function runFlywheelRelease(owner: string, step: WorkflowStep, broker: Broker, candidate: string) {
  const claimed = await step.do("release:claim", once, () => broker.begin(owner, candidate))
  const observations: Array<{ phase: number; trials: number; failures: number; status: string; observedAt: number }> = []
  const promotions: number[] = []
  const startedAt = Date.now()
  try {
    if (claimed.previous.length !== 1 || claimed.previous[0]?.version !== baseline || claimed.previous[0]?.percentage !== 100)
      throw new NonRetryableError("Unexpected dedicated demo baseline")
    const from = await step.do("health:baseline-start", once, async () => Date.now())
    const previousBatches: ProbeBatch[] = []
    for (let i = 0; i < 50; i++) previousBatches.push(await step.do(`health:baseline-${i}`, once, () => probeBatch(origin, `${owner}-baseline-${i}`, [baseline])))
    const previous = await step.do("health:baseline-close", once, async () => cohortSample(previousBatches, baseline, from, Math.max(from + 1, Date.now())))
    for (const phase of [10, 25, 75, 100]) {
      await step.do(`release:promote-${phase}`, once, () => broker.promote(owner, phase))
      promotions.push(phase)
      const phaseStart = await step.do(`health:start-${phase}`, once, async () => Date.now())
      const batches: ProbeBatch[] = []
      let advanced = false
      for (let observation = 0; observation < 3; observation++) {
        await step.do(`release:renew-${phase}-${observation}`, once, () => broker.renew(owner))
        const count = observation === 1 ? Math.ceil(50 / (phase / 100)) : 10
        for (let i = 0; i < count; i++) {
          batches.push(await step.do(`health:sample-${phase}-${observation}-${i}`, once, () => probeBatch(origin, `${owner}-${phase}-${observation}-${i}`, [baseline, candidate])))
          if (batches.at(-1)!.unknown) break
        }
        const point = await step.do(`health:decision-${phase}-${observation}`, once, async () => {
          const current = cohortSample(batches, candidate, phaseStart, Math.max(phaseStart + 1, Date.now()))
          const decision = evaluateHealth(previous, current, { baselineVersion: baseline, candidateVersion: candidate,
            phaseStartedAt: phaseStart, baselineWindow: { from: previous.from, to: previous.to },
            minTrials: 20, maxErrorRate: 0.1, maxIncrease: 0.05, alpha: 0.05, comparisons: 4 })
          return { phase, trials: current.trials, failures: current.failures, status: decision.status, observedAt: Date.now() }
        })
        observations.push(point)
        if (point.status === "regression") throw new NonRetryableError("Conclusive health regression")
        if (point.status === "advance") { advanced = true; break }
        if (observation < 2) await step.sleep(`health:wait-${phase}-${observation}`, "1 minute")
      }
      if (!advanced) throw new NonRetryableError("Health evidence budget exhausted")
    }
    const restored = await step.do("release:lab-cleanup", once, () => broker.rollback(owner))
    if (restored.status !== "rolled-back" || JSON.stringify(restored.deployment.versions) !== JSON.stringify(claimed.previous))
      throw new NonRetryableError("Cleanup did not restore the exact prior allocation")
    return { startedAt, finishedAt: Date.now(), promotions, observations, restored: restored.deployment,
      evidenceSource: "closed-client-http-cohort", wobsVerified: false, releaseCommitted: false }
  } catch (error) {
    await step.do("release:restore-baseline", once, () => broker.rollback(owner))
    throw error
  }
}
