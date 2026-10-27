import type { RuntimeEvent, PlanNode } from "./index.ts"
import type { LifecyclePhase, LifecycleOutcome } from "./lifecycle.ts"

/** Presentation metadata only: no output, plan, payload, actor or review capability. */
export interface RuntimeObservation {
  readonly type: RuntimeEvent["type"]
  readonly workflowId: string
  readonly timestamp: string
  readonly stepId?: string
  readonly status?: PlanNode["status"]
  readonly conclusion?: "success" | "failure"
  readonly phase?: LifecyclePhase
  readonly outcome?: LifecycleOutcome
}

export interface RuntimeObserver {
  readonly id: string
  /** Trusted host callback. Honor abort; this is not a sandbox for arbitrary code. */
  readonly deliver: (event: RuntimeObservation, signal: AbortSignal) => void | Promise<void>
}

export interface ObservationReceipt {
  readonly sequence: number
  readonly observer: string
  readonly event: RuntimeEvent["type"]
  readonly status: "delivered" | "failed" | "timeout" | "blocked"
}

export interface RuntimeObservers {
  readonly publish: (event: RuntimeEvent) => Promise<void>
  readonly snapshot: () => {
    readonly receipts: ReadonlyArray<ObservationReceipt>
    readonly omittedReceipts: number
    readonly droppedEvents: number
  }
}

/**
 * One in-memory delivery session, not durable reconciliation. Failed/uncertain
 * destinations are quarantined for the rest of this session: no blind POST retry.
 * Persist snapshot() separately when required; persistence must fail closed.
 */
export function makeRuntimeObservers(input: ReadonlyArray<RuntimeObserver>, timeoutMs = 20_000): RuntimeObservers {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000 || input.length > 8)
    throw Error("Invalid observational delivery policy")
  const ids = new Set<string>()
  const observers = input.map(observer => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(observer.id) || ids.has(observer.id) || typeof observer.deliver !== "function")
      throw Error("Invalid observational destination")
    ids.add(observer.id)
    return { id: observer.id, deliver: observer.deliver, blocked: false, queue: Promise.resolve() }
  })
  const receipts: ObservationReceipt[] = []
  let sequence = 0, omittedReceipts = 0, droppedEvents = 0
  const record = (receipt: ObservationReceipt) => {
    if (receipts.length === 256) { receipts.shift(); omittedReceipts++ }
    receipts.push(Object.freeze(receipt))
  }
  return Object.freeze({
    async publish(event: RuntimeEvent) {
      const current = ++sequence
      // Bound callback invocations as well as stored diagnostics. No eviction
      // unlocks a destination or creates a new delivery opportunity.
      if (current > 256) { droppedEvents++; return }
      const observation: RuntimeObservation = Object.freeze({ type: event.type,
        workflowId: event.workflowId, timestamp: event.timestamp,
        ...("stepId" in event ? { stepId: event.stepId } : {}),
        ...("status" in event ? { status: event.status } : {}),
        ...("phase" in event ? { phase: event.phase } : {}),
        ...("outcome" in event ? { outcome: event.outcome } : {}),
        ...("conclusion" in event ? { conclusion: event.conclusion } : {}) })
      await Promise.all(observers.map(observer => {
        const delivery = observer.queue.then(async () => {
          let status: ObservationReceipt["status"] = "blocked"
          if (!observer.blocked) {
            const abort = new AbortController()
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              // Promise boundary catches synchronous throw/rejection. Every
              // destination has its own queue/deadline; one cannot cancel another.
              status = await Promise.race([
                Promise.resolve().then(() => observer.deliver(observation, abort.signal)).then(
                  () => "delivered" as const, () => "failed" as const),
                new Promise<"timeout"> (resolve => { timer = setTimeout(() => resolve("timeout"), timeoutMs) }),
              ])
              if (status !== "delivered") observer.blocked = true
            } finally {
              if (timer !== undefined) clearTimeout(timer)
              abort.abort()
            }
          }
          record({ sequence: current, observer: observer.id, event: event.type, status })
        })
        observer.queue = delivery
        return delivery
      }))
    },
    snapshot: () => Object.freeze({ receipts: Object.freeze([...receipts]), omittedReceipts, droppedEvents }),
  })
}
