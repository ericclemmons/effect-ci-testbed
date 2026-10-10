export interface HealthSample {
  readonly version: string
  readonly from: number
  readonly to: number
  /** Closed telemetry watermark, not the time the query was requested. */
  readonly completeThrough: number
  readonly trials: number
  readonly failures: number
  readonly sampling: "unsampled" | "weighted"
}

export interface HealthPolicy {
  readonly baselineVersion: string
  readonly candidateVersion: string
  readonly phaseStartedAt: number
  readonly baselineWindow: { readonly from: number; readonly to: number }
  readonly minTrials: number
  readonly maxErrorRate: number
  /** Absolute percentage-point increase, not a ratio to a possibly zero baseline. */
  readonly maxIncrease: number
  readonly alpha: number
  /** Total phase × metric comparisons sharing this release's error budget. */
  readonly comparisons: number
}

export interface RateInterval { readonly rate: number; readonly low: number; readonly high: number }
export interface HealthDecision {
  readonly status: "uncertain" | "advance" | "regression"
  readonly reason: string
  readonly baseline?: RateInterval
  readonly candidate?: RateInterval
  readonly increase?: { readonly low: number; readonly high: number }
}

/** Anytime-valid conservative Hoeffding bounds under independent, stationary Bernoulli trials.
 * Allocate alpha across both cohorts, all sample counts n (1/[n(n+1)]), and comparisons.
 * Unlike repeatedly peeking at fixed 95% intervals, optional stopping does not spend extra alpha.
 */
export function rateInterval(sample: HealthSample, policy: HealthPolicy): RateInterval {
  const n = sample.trials
  const rate = sample.failures / n
  const radius = Math.sqrt((Math.log(4 * policy.comparisons / policy.alpha) + Math.log(n) + Math.log(n + 1)) / (2 * n))
  return { rate, low: Math.max(0, rate - radius), high: Math.min(1, rate + radius) }
}

export function evaluateHealth(baseline: HealthSample, candidate: HealthSample, policy: HealthPolicy): HealthDecision {
  const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0
  if (!positiveInteger(policy.minTrials) || !positiveInteger(policy.comparisons) ||
    !Number.isFinite(policy.phaseStartedAt) || ![policy.baselineWindow.from, policy.baselineWindow.to].every(Number.isFinite) ||
    policy.baselineWindow.to <= policy.baselineWindow.from || policy.baselineWindow.to > policy.phaseStartedAt || !(policy.alpha > 0 && policy.alpha < 1) ||
    !Number.isFinite(policy.maxErrorRate) || policy.maxErrorRate < 0 || policy.maxErrorRate > 1 ||
    !Number.isFinite(policy.maxIncrease) || policy.maxIncrease < 0 || policy.maxIncrease > 1 ||
    !policy.baselineVersion || !policy.candidateVersion || policy.baselineVersion === policy.candidateVersion) {
    throw new Error("Invalid health policy")
  }
  for (const sample of [baseline, candidate]) {
    if (!Number.isSafeInteger(sample.trials) || sample.trials < 0 || !Number.isSafeInteger(sample.failures) ||
      sample.failures < 0 || sample.failures > sample.trials ||
      ![sample.from, sample.to, sample.completeThrough].every(Number.isFinite) || sample.to <= sample.from) {
      throw new Error("Invalid health sample")
    }
  }
  const uncertain = (reason: string): HealthDecision => ({ status: "uncertain", reason })
  if (baseline.version !== policy.baselineVersion || candidate.version !== policy.candidateVersion) return uncertain("version mismatch")
  if (baseline.from !== policy.baselineWindow.from || baseline.to !== policy.baselineWindow.to || candidate.from !== policy.phaseStartedAt) return uncertain("window does not match the pinned release cohort")
  if (baseline.completeThrough < baseline.to || candidate.completeThrough < candidate.to) return uncertain("telemetry still arriving")
  if (baseline.sampling !== "unsampled" || candidate.sampling !== "unsampled") return uncertain("weighted counts need a sampling-aware estimator")
  if (!baseline.trials || !candidate.trials) return uncertain("needs more independent observations")
  const previous = rateInterval(baseline, policy)
  const current = rateInterval(candidate, policy)
  const increase = { low: current.low - previous.high, high: current.high - previous.low }
  const bounds = { baseline: previous, candidate: current, increase }
  if (baseline.trials < policy.minTrials || candidate.trials < policy.minTrials) return { ...bounds, status: "uncertain", reason: "needs more independent observations" }
  if (current.low > policy.maxErrorRate || increase.low > policy.maxIncrease) return { ...bounds, status: "regression", reason: "conclusive SLO or regression breach" }
  if (current.high <= policy.maxErrorRate && increase.high <= policy.maxIncrease) return { ...bounds, status: "advance", reason: "within SLO and regression budget" }
  return { ...bounds, status: "uncertain", reason: "confidence bounds overlap the release threshold" }
}
