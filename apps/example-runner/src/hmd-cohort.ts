import type { HealthSample } from "../../../packages/cloudflare/src/health-gate.ts"

export interface ProbeOutcome { readonly version: string; readonly healthy: boolean }
export interface ProbeBatch { readonly outcomes: ReadonlyArray<ProbeOutcome>; readonly unknown: number; readonly requested: number; readonly unknownReasons?: Readonly<Record<string, number>> }

/** Closed client-observed HTTP cohort, NOT WOBS ingestion completeness. No retries. */
export async function probeBatch(origin: string, identity: string, allowed: ReadonlyArray<string>, transport: typeof fetch = fetch): Promise<ProbeBatch> {
  if (origin !== "https://effect-ci-hmd-demo.ericclemmons.workers.dev") throw new Error("Invalid probe target")
  const outcomes: ProbeOutcome[] = []
  let unknown = 0
  const unknownReasons: Record<string, number> = {}
  for (let group = 0; group < 10; group++) {
    await Promise.all(Array.from({ length: 10 }, async (_, offset) => {
      let stage = "transport"
      try {
        const response = await transport(`${origin}/health?probe=${encodeURIComponent(identity)}-${group * 10 + offset}`, {
          redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "cache-control": "no-cache" },
        })
        stage = "http-status"
        if (![200, 503].includes(response.status)) { await response.body?.cancel(); throw new Error("Unknown response") }
        stage = "body"
        const value = await response.json() as ProbeOutcome
        stage = "attribution"
        if (!allowed.includes(value.version) || typeof value.healthy !== "boolean" || response.status !== (value.healthy ? 200 : 503)) throw new Error("Invalid attribution")
        outcomes.push({ version: value.version, healthy: value.healthy })
      } catch { unknown++; unknownReasons[stage] = (unknownReasons[stage] ?? 0) + 1 }
    }))
  }
  // Compact redacted diagnostics precede the array in native step logs.
  return { unknown, requested: 100, unknownReasons, outcomes }
}

export function cohortSample(batches: ReadonlyArray<ProbeBatch>, version: string, from: number, to: number): HealthSample {
  const matched = batches.flatMap((batch) => batch.outcomes).filter((item) => item.version === version)
  const complete = batches.every((batch) => batch.unknown === 0 && batch.requested === batch.outcomes.length)
  return { version, from, to, completeThrough: complete ? to : from,
    trials: matched.length, failures: matched.filter((item) => !item.healthy).length, sampling: "unsampled" }
}
