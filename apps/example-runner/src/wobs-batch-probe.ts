import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { collectReceipts, readReceiptSamples } from "./wobs-samples.ts"
import { NonRetryableError } from "cloudflare:workflows"
import { canRetryNativeQuery, nativeSqlPolicy } from "./wobs-sql-policy.ts"
import { nativeDiagnostics } from "./wobs-diagnostics.ts"

const BASELINE = "09593237-23b2-4873-bd04-88c8e8488840"
const ONCE = { retries: { limit: 0, delay: "1 second" } } as const

/** Bounded fixed-target larger cohort proof. No broker, deployment or notification. */
export class WobsBatchProbeWorkflow extends WorkflowEntrypoint<{ ANALYTICS_SQL: AnalyticsSQLBinding }> {
  protected readonly receiptCount: number = 1_000
  override async run(_event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    const from = await step.do("wobs:batch-start", ONCE, async () => Date.now())
    const batch = await step.do("wobs:batch-independent-receipts", ONCE, () => collectReceipts(this.receiptCount, [BASELINE]))
    // HTTP receipt completion is not native invocation completion. A real bounded
    // settling barrier precedes the immutable window close (not a timestamp pad
    // or a query-time watermark). Every expected native outcome is still required.
    await step.sleep("wobs:batch-terminal-settle", "1 second")
    const to = await step.do("wobs:batch-close", ONCE, async () => Math.max(from + 1, Date.now() + 1))
    const observations = []
    for (let attempt = 0; attempt < 6; attempt++) {
      const observation = await step.do(`wobs:batch-sql-${attempt}`, nativeSqlPolicy, async () => {
        try { return await readReceiptSamples(batch, [BASELINE], from, to, (input) => this.env.ANALYTICS_SQL.query(input)) }
        catch (error) {
          if (canRetryNativeQuery(error)) throw new Error("Retryable native SQL service failure")
          throw new NonRetryableError("Native SQL failed without retry permission")
        }
      })
      observations.push(observation)
      if (observation.complete || attempt === 5) {
        // Diagnostics only: a wider native clock envelope must NEVER silently
        // repair the original pinned sample or advance a deployment gate.
        const clockDiagnostic = !observation.complete ? await step.do("wobs:batch-clock-diagnostic", ONCE, async () => {
          const wider = await readReceiptSamples(batch, [BASELINE], from - 60_000, to + 60_000,
            (input) => this.env.ANALYTICS_SQL.query(input))
          return { completeInWiderEnvelope: wider.complete, nativeRows: wider.nativeRows,
            missing: wider.missing, invalid: wider.invalid, conflicts: wider.conflicts,
            earliestMinusStart: wider.nativeTimeRange ? wider.nativeTimeRange.from - from : undefined,
            latestMinusEnd: wider.nativeTimeRange ? wider.nativeTimeRange.to - to : undefined,
            scope: "diagnostic only; original sample is unchanged and remains incomplete" }
        }) : undefined
        return {
          complete: observation.complete, requested: batch.requested, receipts: batch.receipts.length,
          uniqueReceipts: new Set(batch.receipts.map((r) => r.ray)).size, unknown: batch.unknown, observations, clockDiagnostic,
          scope: observation.complete ? "closed synthetic baseline outcomes; no rollout or ambient completeness claim"
            : "incomplete pinned baseline cohort; no rollout, health or completeness claim",
        }
      }
      await step.sleep(`wobs:batch-ingestion-${attempt}`, "30 seconds")
    }
    throw new Error("Missing bounded batch observation")
  }
}

export class WobsLargeBatchProbeWorkflow extends WobsBatchProbeWorkflow {
  protected override readonly receiptCount = 5_000
}

/** Frozen failed-lab window, read-only. Never generates traffic or invokes the broker. */
export class WobsDiagnosticWorkflow extends WorkflowEntrypoint<{ ANALYTICS_SQL: AnalyticsSQLBinding }> {
  override async run(_event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return step.do("wobs:rejected-cohort-diagnostics", ONCE, async () => {
      const result = await this.env.ANALYTICS_SQL.query({
        query: "SELECT timestamp, scriptName, logType, requestId, rayId, sampleInterval, attributes FROM logs.workersLogs WHERE scriptName = $script AND logType = 'cf-worker-event' AND timestamp >= $from AND timestamp < $to LIMIT 6000",
        params: { script: "effect-ci-hmd-demo", from: "2026-10-10T22:14:19.868Z", to: "2026-10-10T22:14:27.874Z" },
      })
      if (result.data.length >= 6000) throw new NonRetryableError("Diagnostic row budget reached")
      return nativeDiagnostics(result.data)
    })
  }
}
