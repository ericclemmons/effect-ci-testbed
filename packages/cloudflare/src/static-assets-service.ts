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
