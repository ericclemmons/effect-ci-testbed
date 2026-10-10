import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import type { ReleaseManager, ReleaseJournal } from "../../release-manager/src/release-manager.ts"
import type { HealthDecision, HealthSample } from "../../../packages/cloudflare/src/health-gate.ts"
import { evaluateHealth } from "../../../packages/cloudflare/src/health-gate.ts"
import { healthChart } from "../../../packages/cloudflare/src/health-chart.ts"
import { collectReceipts, readReceiptSamples, combineSamples } from "./wobs-samples.ts"
import { healthyPhases, healthyBatchSize, maximumHealthyCohorts, assertHealthyNativeBudget } from "./wobs-healthy-budget.ts"
import { verifyHealthyLab } from "./hmd-lab-result.ts"
import { canRetryNativeQuery, nativeSqlPolicy } from "./wobs-sql-policy.ts"

const BASELINE = "09593237-23b2-4873-bd04-88c8e8488840"
const CANDIDATE = "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c"
const ONCE = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const

/** Trusted dedicated-target full healthy rollout lab. All health outcomes are
 * native WOBS, not HTTP bodies. Successful tests clean up rather than commit a
 * production release. No repository code, credentials or notification capability.
 */
export class WobsHealthyWorkflow extends WorkflowEntrypoint<{
  RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "promote" | "rollback" | "renew">
  ANALYTICS_SQL: AnalyticsSQLBinding
}> {
  override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    assertHealthyNativeBudget()
    const owner = event.instanceId
    const broker = this.env.RELEASE_MANAGER
    const initial = await step.do("release:claim", ONCE, () => broker.begin(owner, CANDIDATE))
    const usedRays = new Set<string>()
    const observations: Array<{ phase: number; observedAt: number; decision: HealthDecision; chart: string;
      native: { trials: number; failures: number; requested: number } }> = []
    const promotions: Array<{ percentage: number; deployment: ReleaseJournal["deployment"] }> = []
    const nativeCohort = async (key: string, count: number, versions: ReadonlyArray<string>) => {
      await step.do(`release:renew-${key}-receipts`, ONCE, () => broker.renew(owner))
      const from = await step.do(`${key}:start`, ONCE, async () => Date.now())
      const batch = await step.do(`${key}:independent-receipts`, ONCE, () => collectReceipts(count, versions))
      for (const receipt of batch.receipts) {
        if (usedRays.has(receipt.ray)) throw new Error("Native receipt reused across cohorts")
        usedRays.add(receipt.ray)
      }
      await step.sleep(`${key}:terminal-settle`, "1 second")
      const to = await step.do(`${key}:close`, ONCE, async () => Math.max(from + 1, Date.now() + 1))
      for (let attempt = 0; attempt < 6; attempt++) {
        await step.do(`release:renew-${key}-sql-${attempt}`, ONCE, () => broker.renew(owner))
        const result = await step.do(`${key}:sql-${attempt}`, nativeSqlPolicy, async () => {
          try { return await readReceiptSamples(batch, versions, from, to, (input) => this.env.ANALYTICS_SQL.query(input)) }
          catch (error) {
            if (canRetryNativeQuery(error)) throw new Error("Retryable native SQL service failure")
            throw new NonRetryableError("Native SQL failed without retry permission")
          }
        })
        if (result.complete || attempt === 5) return result
        await step.sleep(`${key}:ingestion-${attempt}`, "30 seconds")
      }
      throw new Error("Missing native cohort")
    }
    try {
      if (initial.previous.length !== 1 || initial.previous[0]?.version !== BASELINE || initial.previous[0]?.percentage !== 100) {
        throw new NonRetryableError("Unexpected healthy lab baseline")
      }
      const baseline = await nativeCohort("health:baseline", 100, [BASELINE])
      if (!baseline.complete) throw new Error("Incomplete native baseline")
      const previous = baseline.samples[BASELINE]!
      const releaseStartedAt = await step.do("health:release-start", ONCE, async () => Date.now())
      for (const phase of healthyPhases) {
        const promoted = await step.do(`release:promote-${phase}`, ONCE, () => broker.promote(owner, phase))
        if (promoted.deployment.versions.find((v) => v.version === CANDIDATE)?.percentage !== phase ||
          promoted.deployment.versions.length !== (phase === 100 ? 1 : 2) ||
          (phase < 100 && promoted.deployment.versions.find((v) => v.version === BASELINE)?.percentage !== 100 - phase) ||
          promoted.deployment.versions.reduce((n, v) => n + v.percentage, 0) !== 100) throw new Error("Invalid healthy promotion")
        promotions.push({ percentage: phase, deployment: promoted.deployment })
        const phaseStartedAt = await step.do(`health:phase-${phase}:start`, ONCE, async () => Date.now())
        const samples: HealthSample[] = []
        let advanced = false
        for (let index = 0; index <= maximumHealthyCohorts(phase); index++) {
          // A fresh phase must observe its own cohort. First10 never meet minTrials.
          const count = index === 0 ? 10 : healthyBatchSize
          const observed = await nativeCohort(`health:phase-${phase}:sample-${index}`, count, [BASELINE, CANDIDATE])
          if (!observed.complete) throw new Error("Incomplete native phase cohort")
          const sample = observed.samples[CANDIDATE]!
          samples.push(sample)
          const candidate = combineSamples(samples, CANDIDATE, phaseStartedAt, sample.to)
          const decision = evaluateHealth(previous, candidate, { baselineVersion: BASELINE, candidateVersion: CANDIDATE,
            baselineWindow: { from: previous.from, to: previous.to }, phaseStartedAt,
            minTrials: 20, maxErrorRate: 0.1, maxIncrease: 0.05, alpha: 0.05, comparisons: healthyPhases.length })
          const points = [...observations, { observedAt: sample.to, decision }].map((p) => ({
            elapsedSeconds: (p.observedAt - releaseStartedAt) / 1_000, decision: p.decision }))
          observations.push(await step.do(`health:phase-${phase}:snapshot-${index}`, ONCE, async () => ({
            phase, observedAt: sample.to, decision, native: { trials: candidate.trials, failures: candidate.failures, requested: count },
            chart: healthChart(points, { baseline: BASELINE, candidate: CANDIDATE, maxErrorRate: 0.1 }),
          })))
          if (decision.status === "regression") await step.do(`health:phase-${phase}:conclusive-regression`,
            { retries: { limit: 10, delay: "1 minute" } }, async () => { throw new NonRetryableError("Conclusive HMD SLO breach") })
          if (decision.status === "advance") { advanced = true; break }
          if (index < maximumHealthyCohorts(phase)) await step.sleep(`health:phase-${phase}:uncertain-${index}`, "1 minute")
        }
        if (!advanced) throw new Error("Native healthy observation budget exhausted")
      }
      const restored = await step.do("release:lab-cleanup", ONCE, () => broker.rollback(owner))
      verifyHealthyLab(observations, restored, BASELINE)
      return { status: "healthy-all-phases", evidenceSource: "closed-native-workers-logs-cohort", wobsVerified: true,
        releaseCommitted: false, promotions, observations, restored: restored.deployment,
        scope: "dedicated-target healthy four-phase WOBS lab; not a committed production release or ambient traffic" }
    } catch {
      await step.do("release:restore-after-failure", ONCE, () => broker.rollback(owner))
      // Unexpected failures must not masquerade as successful rollback test evidence.
      throw new Error("Native healthy lab failed; baseline restoration completed")
    }
  }
}
