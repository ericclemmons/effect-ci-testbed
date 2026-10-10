import type { HealthDecision } from "./health-gate.ts"

export interface VersionAllocation {
  readonly version: string
  readonly percentage: number
}

export interface ReleaseState {
  readonly candidate: string
  readonly previous: ReadonlyArray<VersionAllocation>
  readonly phases: ReadonlyArray<number>
  readonly phase: number
  readonly observations: number
  readonly maxObservations: number
  readonly status: "observing" | "complete" | "rollback"
  readonly reason?: string
}

/** Pure release state. The runner owns mutations, durable journals, retries and leases. */
export function beginRelease(candidate: string, previous: ReadonlyArray<VersionAllocation>,
  options: { readonly phases?: ReadonlyArray<number>; readonly maxObservations?: number } = {}): ReleaseState {
  const phases = options.phases ?? [10, 25, 75, 100]
  const maxObservations = options.maxObservations ?? 11 // First look + ten retries.
  if (!candidate || !previous.length || previous.some((entry) => !entry.version || entry.version === candidate ||
    !Number.isFinite(entry.percentage) || entry.percentage <= 0 || entry.percentage > 100) ||
    new Set(previous.map((entry) => entry.version)).size !== previous.length ||
    Math.abs(previous.reduce((sum, entry) => sum + entry.percentage, 0) - 100) > 1e-8 ||
    !phases.length || phases.some((value, index) => !Number.isFinite(value) || value <= 0 || value > 100 ||
      (index > 0 && value <= phases[index - 1]!)) || phases.at(-1) !== 100 ||
    !Number.isSafeInteger(maxObservations) || maxObservations < 1) {
    throw new Error("Invalid progressive release policy")
  }
  // Capture values, not mutable objects owned by the caller.
  return { candidate, previous: previous.map((entry) => ({ ...entry })), phases: [...phases],
    phase: 0, observations: 0, maxObservations, status: "observing" }
}

/** Keep the old versions' relative traffic split; never replace a multi-version baseline with one UUID. */
export function releaseAllocation(state: ReleaseState): ReadonlyArray<VersionAllocation> {
  if (state.status === "rollback") return state.previous.map((entry) => ({ ...entry }))
  const percentage = state.phases[state.phase]!
  return [
    ...state.previous.flatMap((entry) => percentage === 100 ? [] :
      [{ version: entry.version, percentage: entry.percentage * (100 - percentage) / 100 }]),
    { version: state.candidate, percentage },
  ]
}

/** One closed health observation, not one invocation log or retry of the same request. */
export function recordHealth(state: ReleaseState, decision: HealthDecision): ReleaseState {
  if (state.status !== "observing") throw new Error("Release has already reached a terminal decision")
  if (!["advance", "uncertain", "regression"].includes(decision.status)) throw new Error("Invalid health decision")
  const observations = state.observations + 1
  if (decision.status === "regression") return { ...state, observations, status: "rollback", reason: decision.reason }
  if (decision.status === "uncertain") return observations >= state.maxObservations
    ? { ...state, observations, status: "rollback", reason: "health observation budget exhausted: " + decision.reason }
    : { ...state, observations, reason: decision.reason }
  if (state.phase === state.phases.length - 1) return { ...state, observations, status: "complete", reason: decision.reason }
  return { ...state, phase: state.phase + 1, observations: 0, reason: decision.reason }
}
