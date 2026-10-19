import { sqlFetchOutcome } from "./wobs-cohort.ts"

/** Redacted diagnostics only. No identities, attributes, logs or substitute health sample. */
export function nativeDiagnostics(data: ReadonlyArray<Record<string, unknown>>) {
  const weights: Record<string, number> = {}
  let valid = 0
  let unknownWeight = 0
  let rejected = 0
  for (const row of data) {
    const weight = row.sampleInterval
    if (typeof weight === "number" && Number.isSafeInteger(weight) && weight >= 1) weights[String(weight)] = (weights[String(weight)] ?? 0) + 1
    else unknownWeight++
    if (sqlFetchOutcome(row)) valid++
    else rejected++
  }
  return { storedRows: data.length, weights, unknownWeight, valid, rejected,
    scope: "diagnostic only; never replaces independent receipts or repairs a health sample" }
}
