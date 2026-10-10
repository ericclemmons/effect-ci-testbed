import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"

/** Authenticated CF API invocation only; returns schema/availability, never raw logs. */
export class AnalyticsProbeWorkflow extends WorkflowEntrypoint<{ ANALYTICS_SQL: AnalyticsSQLBinding }> {
  override async run(_event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return step.do("analytics:workers-log-availability", { retries: { limit: 0, delay: "1 second" } }, async () => {
      const result = await this.env.ANALYTICS_SQL.query({
        query: "SELECT timestamp, scriptName, sampleInterval, attributes FROM logs.workersLogs WHERE scriptName = $script AND timestamp >= $start LIMIT 10",
        params: { script: "effect-ci-hmd-demo", start: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
      })
      return { available: true, rows: result.rows, columns: result.data.length ? Object.keys(result.data[0]!) : [],
        attributeKeys: [...new Set(result.data.flatMap((row) => Object.keys((row.attributes ?? {}) as object)))].filter((key) =>
          ["$workers.scriptVersion.id", "hmd.versionId", "hmd.outcome", "hmd.invocation"].includes(key)),
        versionIds: [...new Set(result.data.flatMap((row) => {
          const attributes = (row.attributes ?? {}) as Record<string, unknown>
          return [attributes["$workers.scriptVersion.id"], attributes["hmd.versionId"]].flatMap((value) =>
            typeof value === "string" && /^[a-f0-9-]{36}$/.test(value) ? [value] : [])
        }))],
        sampleIntervals: [...new Set(result.data.map((row) => {
          const value = Number(row.sampleInterval)
          return Number.isSafeInteger(value) && value > 0 ? value : "unknown"
        }))], statistics: result.statistics }
    })
  }
}
