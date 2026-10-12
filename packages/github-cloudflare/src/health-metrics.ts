import type { HealthSample, RateInterval } from "../../cloudflare/src/health-gate.ts"

/** Only semantic observations cross provider boundaries, never image URLs or capabilities. */
export interface HealthMetrics {
  readonly snapshot: string
  readonly previous: HealthSample & { readonly interval?: RateInterval }
  readonly current: HealthSample & { readonly interval?: RateInterval }
  readonly maxErrorRate: number
  readonly maxIncrease: number
}

const invalid = (): never => { throw new Error("Invalid health metrics") }
const fraction = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1
const cohort = (sample: HealthMetrics["previous"]): HealthMetrics["previous"] => {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(sample.version) ||
    ![sample.from, sample.to, sample.completeThrough].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 8_640_000_000_000_000) ||
    sample.to <= sample.from || !Number.isSafeInteger(sample.trials) || sample.trials < 0 ||
    !Number.isSafeInteger(sample.failures) || sample.failures < 0 || sample.failures > sample.trials ||
    !["unsampled", "weighted"].includes(sample.sampling)) invalid()
  const interval = sample.interval
  if (interval && (!sample.trials || sample.sampling !== "unsampled" || sample.completeThrough < sample.to ||
    ![interval.rate, interval.low, interval.high].every(fraction) || interval.low > interval.rate ||
    interval.rate > interval.high || Math.abs(interval.rate - sample.failures / sample.trials) > 1e-12)) invalid()
  return Object.freeze({ version: sample.version, from: sample.from, to: sample.to,
    completeThrough: sample.completeThrough, trials: sample.trials, failures: sample.failures,
    sampling: sample.sampling, ...(interval ? { interval: Object.freeze({
      rate: interval.rate, low: interval.low, high: interval.high }) } : {}) })
}

export function copyHealthMetrics(metrics: HealthMetrics): Readonly<HealthMetrics> {
  if (!/^[a-f0-9]{64}$/.test(metrics.snapshot) || !fraction(metrics.maxErrorRate) || !fraction(metrics.maxIncrease)) invalid()
  const previous = cohort(metrics.previous)
  const current = cohort(metrics.current)
  if (previous.version === current.version || previous.to > current.from) invalid()
  return Object.freeze({ snapshot: metrics.snapshot, previous, current,
    maxErrorRate: metrics.maxErrorRate, maxIncrease: metrics.maxIncrease })
}

const percent = (n: number) => `${(n * 100).toFixed(2)}%`
const state = (sample: HealthMetrics["previous"]) => sample.sampling === "weighted" ? "weighted; not independent trials" :
  sample.completeThrough < sample.to ? "telemetry still arriving" : !sample.trials ? "no observations" :
    sample.interval ? "complete cohort" : "bounds unavailable"

/** Markdown uses only validated numbers/IDs. Missing evidence is never rendered as 0% health. */
export function healthMetricsMarkdown(input: HealthMetrics): string {
  const metrics = copyHealthMetrics(input)
  const row = (label: string, sample: HealthMetrics["previous"]) =>
    `| ${label} \`${sample.version}\` | ${sample.failures}/${sample.trials} | ${sample.interval ? percent(sample.interval.rate) : "unavailable"} | ${sample.interval ? `${percent(sample.interval.low)}–${percent(sample.interval.high)}` : "unavailable"} | ${state(sample)} |`
  return `| Version | Observed errors/count | Error rate | Confidence bounds | Evidence |\n| --- | ---: | ---: | --- | --- |\n${row("Previous", metrics.previous)}\n${row("Current", metrics.current)}\n\nPrevious window: ${new Date(metrics.previous.from).toISOString()} → ${new Date(metrics.previous.to).toISOString()}. Current window: ${new Date(metrics.current.from).toISOString()} → ${new Date(metrics.current.to).toISOString()}.\n\nError-rate limit: ${percent(metrics.maxErrorRate)}; allowed increase: ${(metrics.maxIncrease * 100).toFixed(2)} percentage points. Historical confidence bounds, not a forecast or causal comparison. Counts with missing or weighted telemetry do not establish health. Snapshot: \`${metrics.snapshot}\`.`
}
