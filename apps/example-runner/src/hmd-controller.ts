import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"
import { evaluateHealth, type HealthDecision } from "../../../packages/cloudflare/src/health-gate.ts"
import { healthChart } from "../../../packages/cloudflare/src/health-chart.ts"
import { probeBatch, cohortSample, type ProbeBatch } from "./hmd-cohort.ts"
import { verifyLabRollback, verifyHealthyLab } from "./hmd-lab-result.ts"
import { assertHmdBudget, HMD_SUBREQUEST_LIMIT, hmdPhases, observationCount, baselineBatchCount, sampleBatchCount } from "./hmd-budget.ts"

const baselineVersion = "09593237-23b2-4873-bd04-88c8e8488840"
const regressionVersion = "02de9b2e-95d0-49e6-b787-467e25c5a65c"
const healthyVersion = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
const origin = "https://effect-ci-hmd-demo.ericclemmons.workers.dev"
const noRetry = { retries: { limit: 0, delay: "1 second" } } as const

/** Trusted dedicated-lab controller. No repo-defined code, token, URL or policy. */
export class HostedHmdWorkflow extends WorkflowEntrypoint<{ RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "promote" | "rollback" | "renew"> }> {
  override async run(event: Readonly<WorkflowEvent<{ scenario: "regression" | "exhaustion" | "healthy" }>>, step: WorkflowStep) {
    const scenario = event.payload?.scenario
    if (!["regression", "exhaustion", "healthy"].includes(scenario)) throw new NonRetryableError("Unknown HMD scenario")
    assertHmdBudget(HMD_SUBREQUEST_LIMIT, scenario)
    const owner = event.instanceId
    const broker = this.env.RELEASE_MANAGER
    const candidateVersion = scenario === "healthy" ? healthyVersion : regressionVersion
    const initial = await step.do("release:claim", noRetry, () => broker.begin(owner, candidateVersion))
    const observations: Array<{ phase: number; observedAt: number; decision: HealthDecision; chart: string }> = []
    const promotions: Array<{ percentage: number; deployment: unknown }> = []
    try {
      if (initial.previous.length !== 1 || initial.previous[0]?.version !== baselineVersion || initial.previous[0]?.percentage !== 100) throw new NonRetryableError("Unexpected lab baseline")
      const from = await step.do("health:baseline-start", noRetry, async () => Date.now())
      const baselineBatches: ProbeBatch[] = []
      for (let batch = 0; batch < baselineBatchCount(scenario); batch++) {
        baselineBatches.push(await step.do(`health:baseline-${batch}`, noRetry, () => probeBatch(origin, `${owner}-baseline-${batch}`, [baselineVersion])))
        if (baselineBatches.at(-1)!.unknown) throw new Error("Incomplete baseline HTTP cohort")
      }
      const previous = await step.do("health:baseline-close", noRetry, async () => cohortSample(baselineBatches, baselineVersion, from, Math.max(from + 1, Date.now())))
      for (const phase of scenario === "healthy" ? hmdPhases : [10]) {
        const promoted = await step.do(`release:promote-${phase}`, noRetry, () => broker.promote(owner, phase))
        promotions.push({ percentage: phase, deployment: promoted.deployment })
        const phaseStartedAt = await step.do(`health:phase-start-${phase}`, noRetry, async () => Date.now())
        const batches: ProbeBatch[] = []
        let advanced = false
        for (let index = 0; index < observationCount(scenario); index++) {
          await step.do(`release:renew-${phase}-${index}`, noRetry, () => broker.renew(owner))
          const batchCount = sampleBatchCount(scenario, phase, index)
          for (let batch = 0; batch < batchCount; batch++) {
            batches.push(await step.do(`health:sample-${phase}-${index}-${batch}`, noRetry, () =>
              probeBatch(origin, `${owner}-${phase}-${index}-${batch}`, [baselineVersion, candidateVersion])))
            if (batches.at(-1)!.unknown) break // Never burn the remaining request budget on missing evidence.
          }
          const to = await step.do(`health:close-${phase}-${index}`, noRetry, async () => Math.max(phaseStartedAt + index + 1, Date.now()))
          const candidate = cohortSample(batches, candidateVersion, phaseStartedAt, to)
          // Explicit fault injection models incomplete evidence, not a fake healthy outcome.
          const evidence = scenario === "exhaustion" ? { ...candidate, completeThrough: phaseStartedAt } : candidate
          const decision = evaluateHealth(previous, evidence, { baselineVersion, candidateVersion,
            phaseStartedAt, baselineWindow: { from: previous.from, to: previous.to },
            minTrials: 20, maxErrorRate: 0.1, maxIncrease: 0.05, alpha: 0.05, comparisons: 4 })
          const points = [...observations.filter((item) => item.phase === phase), { observedAt: to, decision }].map((item) => ({ elapsedSeconds: (item.observedAt - phaseStartedAt) / 1000, decision: item.decision }))
          const snapshot = await step.do(`health:snapshot-${phase}-${index}`, noRetry, async () => ({ phase, observedAt: to, decision,
            chart: healthChart(points, { baseline: baselineVersion, candidate: candidateVersion, maxErrorRate: 0.1 }) }))
          observations.push(snapshot)
          if (decision.status === "regression") {
            await step.do("health:conclusive-regression", { retries: { limit: 10, delay: "1 minute" } }, async () => {
              throw new NonRetryableError("Conclusive HMD SLO breach")
            })
          }
          if (decision.status === "advance") { advanced = true; break }
          if (index < observationCount(scenario) - 1) await step.sleep(`health:uncertain-${phase}-${index}`, "1 minute")
        }
        if (!advanced) throw new Error("HMD observation budget exhausted")
      }
      // Dedicated-lab cleanup AFTER the final 100% health gate, not a release failure.
      const restored = await step.do("release:lab-cleanup", noRetry, () => broker.rollback(owner))
      verifyHealthyLab(observations, restored, baselineVersion)
      return { status: "healthy-all-phases", scenario, promotions, restored: restored.deployment, observations,
        evidenceSource: "closed-client-http-cohort", wobsVerified: false, releaseCommitted: false }
    } catch (error) {
      const restored = await step.do("release:restore-baseline", noRetry, () => broker.rollback(owner))
      const reason = error instanceof Error ? error.message : "HMD failed closed"
      if (scenario === "healthy") throw new Error("Healthy rollout failed; baseline rollback completed")
      verifyLabRollback(scenario, reason, observations.map((item) => item.decision), restored, baselineVersion)
      return { status: "rolled-back", scenario, reason,
        restored: restored.deployment, observations, evidenceSource: "closed-client-http-cohort", wobsVerified: false }
    }
  }
}
