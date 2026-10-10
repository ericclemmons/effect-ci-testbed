import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import type { ReleaseManager, ReleaseJournal } from "../../release-manager/src/release-manager.ts"
import type { HealthSample, HealthDecision } from "../../../packages/cloudflare/src/health-gate.ts"
import { evaluateHealth } from "../../../packages/cloudflare/src/health-gate.ts"
import { healthChart } from "../../../packages/cloudflare/src/health-chart.ts"
import { collectReceipts, readReceiptSamples, combineSamples } from "./wobs-samples.ts"
import { verifyLabRollback } from "./hmd-lab-result.ts"

const BASELINE = "09593237-23b2-4873-bd04-88c8e8488840"
const CANDIDATE = "02de9b2e-95d0-49e6-b787-467e25c5a65c"
const ONCE = { retries: { limit: 0, delay: "1 second" } } as const

/** Fixed-target bounded regression lab: only WOBS native terminal outcomes gate
 * rollback. This is NOT the healthy four-phase controller or production traffic.
 */
export class WobsReleaseWorkflow extends WorkflowEntrypoint<{
  RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "promote" | "rollback" | "renew">
  ANALYTICS_SQL: AnalyticsSQLBinding
}> {
  override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    const owner = event.instanceId
    const broker = this.env.RELEASE_MANAGER
    const initial = await step.do("release:claim", ONCE, () => broker.begin(owner, CANDIDATE))
    const observations: Array<{ phase: number; observedAt: number; decision: HealthDecision; chart: string }> = []
    let promotion: ReleaseJournal["deployment"] | undefined
    const usedRays = new Set<string>()
    const nativeCohort = async (key: string, count: number, versions: ReadonlyArray<string>) => {
      const from = await step.do(`${key}:start`, ONCE, async () => Date.now())
      const batch = await step.do(`${key}:independent-receipts`, ONCE, () => collectReceipts(count, versions))
      for (const receipt of batch.receipts) {
        if (usedRays.has(receipt.ray)) throw new Error("Native receipt reused across cohorts")
        usedRays.add(receipt.ray)
      }
      const to = await step.do(`${key}:close`, ONCE, async () => Math.max(from + 1, Date.now() + 1))
      let result
      for (let attempt = 0; attempt < 6; attempt++) {
        result = await step.do(`${key}:sql-${attempt}`, ONCE, () => readReceiptSamples(batch, versions, from, to,
          (input) => this.env.ANALYTICS_SQL.query(input)))
        if (result.complete || attempt === 5) return result
        await step.sleep(`${key}:ingestion-${attempt}`, "30 seconds")
      }
      throw new Error("Missing native observation")
    }
    try {
      if (initial.previous.length !== 1 || initial.previous[0]?.version !== BASELINE || initial.previous[0]?.percentage !== 100) throw new NonRetryableError("Unexpected lab baseline")
      const baseline = await nativeCohort("health:baseline", 100, [BASELINE])
      if (!baseline.complete) throw new Error("Incomplete baseline native cohort")
      const previous = baseline.samples[BASELINE]!
      const promoted = await step.do("release:promote-10", ONCE, () => broker.promote(owner, 10))
      promotion = promoted.deployment
      if (promotion.versions.find((v) => v.version === CANDIDATE)?.percentage !== 10 ||
        promotion.versions.find((v) => v.version === BASELINE)?.percentage !== 90) throw new Error("Invalid lab promotion")
      const phaseStartedAt = await step.do("health:phase-start", ONCE, async () => Date.now())
      const samples: HealthSample[] = []
      for (let index = 0; index < 10; index++) {
        await step.do(`release:renew-${index}`, ONCE, () => broker.renew(owner))
        // First cohort has at most ten candidate observations: deterministically uncertain.
        const observed = await nativeCohort(`health:sample-${index}`, index === 0 ? 10 : 100, [BASELINE, CANDIDATE])
        const sample = observed.samples[CANDIDATE]!
        samples.push(sample)
        const candidate = combineSamples(samples, CANDIDATE, phaseStartedAt, sample.to)
        const decision = evaluateHealth(previous, candidate, { baselineVersion: BASELINE, candidateVersion: CANDIDATE,
          baselineWindow: { from: previous.from, to: previous.to }, phaseStartedAt,
          minTrials: 20, maxErrorRate: 0.1, maxIncrease: 0.05, alpha: 0.05, comparisons: 4 })
        const points = [...observations, { observedAt: sample.to, decision }].map((point) => ({ elapsedSeconds: (point.observedAt - phaseStartedAt) / 1000, decision: point.decision }))
        observations.push(await step.do(`health:snapshot-${index}`, ONCE, async () => ({ phase: 10, observedAt: sample.to, decision,
          chart: healthChart(points, { baseline: BASELINE, candidate: CANDIDATE, maxErrorRate: 0.1 }) })))
        if (decision.status === "regression") await step.do("health:conclusive-regression", { retries: { limit: 10, delay: "1 minute" } }, async () => {
          throw new NonRetryableError("Conclusive HMD SLO breach")
        })
        if (decision.status === "advance") throw new Error("Unexpected healthy failing candidate")
        if (index < 9) await step.sleep(`health:uncertain-${index}`, "1 minute")
      }
      throw new Error("HMD observation budget exhausted")
    } catch (error) {
      const restored = await step.do("release:restore-baseline", ONCE, () => broker.rollback(owner))
      const reason = error instanceof Error ? error.message : "HMD failed closed"
      verifyLabRollback("regression", reason, observations.map((item) => item.decision), restored, BASELINE)
      return { status: "rolled-back", reason, promotion, restored: restored.deployment, observations,
        evidenceSource: "closed-native-workers-logs-cohort", wobsVerified: true, releaseCommitted: false,
        scope: "bounded ten-percent regression lab; not healthy four-phase promotion or ambient traffic" }
    }
  }
}
