import { HMD_SUBREQUEST_LIMIT } from "./hmd-budget.ts"
import { SQL_PARTITION_SIZE } from "./wobs-samples.ts"
import { nativeSqlPolicy } from "./wobs-sql-policy.ts"

export const healthyPhases = [10, 25, 75, 100] as const
export const healthyBatchSize = 5_000
export const maximumHealthyCohorts = (phase: number) => {
  if (!healthyPhases.some((value) => value === phase)) throw new Error("Invalid healthy phase")
  return Math.ceil(6_000 / (healthyBatchSize * phase / 100))
}
export const maximumHealthyRequests = () => 100 + healthyPhases.reduce((n, phase) =>
  n + 10 + maximumHealthyCohorts(phase) * healthyBatchSize, 0)
// Six ingestion reads, at most three native service attempts each. Partitions
// are fixed before execution, not an unbounded response to missing evidence.
export const maximumHealthyQueries = () => 6 * (nativeSqlPolicy.retries.limit + 1) * (1 + healthyPhases.reduce((n, phase) =>
  n + 1 + maximumHealthyCohorts(phase) * Math.ceil(healthyBatchSize / SQL_PARTITION_SIZE), 0))

export function assertHealthyNativeBudget(limit = HMD_SUBREQUEST_LIMIT) {
  if (maximumHealthyRequests() + maximumHealthyQueries() + 10_000 > limit) {
    throw new Error("Native HMD budget leaves no checkpoint and recovery headroom")
  }
}
