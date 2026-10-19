export const HMD_SUBREQUEST_LIMIT = 150_000
export type HmdScenario = "healthy" | "regression" | "exhaustion"
export const hmdPhases = [10, 25, 75, 100] as const
export const observationCount = (scenario: HmdScenario) => scenario === "healthy" ? 3 : 10
export const baselineBatchCount = (scenario: HmdScenario) => scenario === "healthy" ? 50 : 1
export const sampleBatchCount = (scenario: HmdScenario, phase: number, index: number) =>
  scenario !== "healthy" ? 1 : index === 1 ? Math.ceil(50 / (phase / 100)) : 10
export function maximumProbeRequests(scenario: HmdScenario) {
  return 100 * (baselineBatchCount(scenario) + (scenario === "healthy" ? hmdPhases : [10]).reduce((total, phase) =>
    total + Array.from({ length: observationCount(scenario) }, (_, index) => sampleBatchCount(scenario, phase, index)).reduce((a, b) => a + b, 0), 0))
}

/** Reserve room for native checkpoints and recovery RPC, not just HTTP fetches. */
export function assertHmdBudget(limit: number, scenario: HmdScenario) {
  if (maximumProbeRequests(scenario) + 10_000 > limit) throw new Error("HMD request budget leaves no recovery headroom")
}
