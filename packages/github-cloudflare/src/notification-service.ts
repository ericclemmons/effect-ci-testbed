import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ServiceMap from "effect/ServiceMap"
import type { RunSnapshot } from "./run-card.ts"

export type NotificationReceipt = Readonly<Record<string, string>>
export interface NotificationProvider {
  /** Stable checkpoint namespace; unique within one fan-out. */
  readonly id: string
  readonly deliver: (run: RunSnapshot, previous: NotificationReceipt | undefined) => Effect.Effect<NotificationReceipt, unknown>
}
export type Delivery =
  | { readonly provider: string; readonly status: "delivered"; readonly receipt: NotificationReceipt }
  | { readonly provider: string; readonly status: "failed" }
export type NotificationCheckpoint = (provider: string, key: string, deliver: () => Promise<Delivery>) => Promise<Delivery>

export class Notifications extends ServiceMap.Service<Notifications, {
  readonly publish: (key: string, run: RunSnapshot) => Effect.Effect<ReadonlyArray<Delivery>>
}>()("@effect-ci-testbed/Notifications") {}

/** One service with explicit fan-out, not competing layers for the same service tag.
 * Construct once per run. The host serializes publish calls and checkpoints each provider.
 * Receipts contain external message IDs only, never credentials or approval tokens.
 */
export const notificationLayer = (
  providers: ReadonlyArray<NotificationProvider>,
  checkpoint: NotificationCheckpoint = (_provider, _key, deliver) => deliver(),
) => {
  const ids = new Set<string>()
  for (const provider of providers) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider.id) || ids.has(provider.id)) {
      throw new Error("Notification provider IDs must be unique, stable slugs")
    }
    ids.add(provider.id)
  }
  const registered = [...providers]
  const receipts = new Map<string, NotificationReceipt>()
  return Layer.succeed(Notifications)({
    publish: (key, run) => Effect.all(registered.map((provider) => Effect.tryPromise({
      try: async () => {
        const delivery = await checkpoint(provider.id, key, () => Effect.runPromise(
          Effect.suspend(() => provider.deliver(run, receipts.get(provider.id))).pipe(
            Effect.map((receipt): Delivery => ({ provider: provider.id, status: "delivered", receipt })),
            Effect.catchCause(() => Effect.succeed<Delivery>({ provider: provider.id, status: "failed" })),
          ),
        ))
        if (delivery.status === "delivered") receipts.set(provider.id, delivery.receipt)
        return delivery
      },
      // Transport/checkpoint exceptions may include credentials. Never expose them.
      catch: () => undefined,
    }).pipe(Effect.catchCause(() => Effect.succeed<Delivery>({ provider: provider.id, status: "failed" })))), { concurrency: "unbounded" }),
  })
}

export type { RunSnapshot } from "./run-card.ts"
