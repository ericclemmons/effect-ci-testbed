import * as Effect from "effect/Effect"
import * as ServiceMap from "effect/ServiceMap"
import type { StaticAssetReceipt } from "./static-assets-journal.ts"
export interface StaticAssetsService {
  readonly capture: () => Effect.Effect<string, unknown>
  readonly publish: (revision: string) => Effect.Effect<string, unknown>
  readonly verify: (revision: string) => Effect.Effect<StaticAssetReceipt, unknown>
}
/** Host provides the closed capability. No token, account, target or module input. */
export class StaticAssets extends ServiceMap.Service<StaticAssets, StaticAssetsService>()("@effect-ci-testbed/StaticAssets") {}

/** Keep known host stages useful without reflecting arbitrary upstream/RPC errors. */
export function staticAssetHostError(error: unknown): Error {
  const message = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined
  const stages = ["Static deployment allocation mismatch", "Static version identity mismatch", "Static version binding mismatch",
    "Static target deployment drift; no traffic write", "Static served asset unavailable", "Static serving policy mismatch",
    "Static served bytes mismatch", "Static served identity unavailable", "Static served identity mismatch",
    "Static publication requires reconciliation", "Static source read unavailable", "Static reconciliation identity mismatch"]
  return new Error(typeof message === "string" && (stages.includes(message) || /^Static Assets API unavailable(?: \(HTTP [1-5]\d\d\))?$/.test(message))
    ? message : "Static Assets host operation failed")
}
