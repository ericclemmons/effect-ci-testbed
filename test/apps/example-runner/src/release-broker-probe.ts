import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"

// Fixed lab fixture, not arbitrary repository code or a user-selected deployment target.
const candidate = "02de9b2e-95d0-49e6-b787-467e25c5a65c"
const baseline = "09593237-23b2-4873-bd04-88c8e8488840"

/** Authenticated Cloudflare Workflow API only. No credential or container in the caller. */
export class ReleaseBrokerProbeWorkflow extends WorkflowEntrypoint<{ RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "promote" | "rollback" | "reconcile"> }> {
  override async run(event: Readonly<WorkflowEvent<{ reconcileOwner?: string; rollbackOwner?: string; abandon?: boolean }>>, step: WorkflowStep) {
    const owner = event.instanceId
    const broker = this.env.RELEASE_MANAGER
    const noRetry = { retries: { limit: 0, delay: "1 second" } } as const
    if (event.payload?.rollbackOwner) {
      // Authenticated operator recovery after a fatal Workflow platform error.
      return step.do("release:operator-rollback", noRetry, () => broker.rollback(event.payload.rollbackOwner!))
    }
    if (event.payload?.reconcileOwner) {
      // Explicit operator recovery: only confirms an already-written intent; no POST.
      return step.do("release:reconcile", noRetry, () => broker.reconcile(event.payload.reconcileOwner!))
    }
    const initial = await step.do("release:claim", noRetry, () => broker.begin(owner, candidate, event.payload?.abandon ? 30 : undefined))
    let promoted
    let restored
    try {
      if (initial.previous.length !== 1 || initial.previous[0]?.version !== baseline || initial.previous[0]?.percentage !== 100) {
        throw new Error("Unexpected lab baseline; refusing promotion")
      }
      promoted = await step.do("release:promote-10", noRetry, () => broker.promote(owner, 10))
      if (event.payload?.abandon) {
        // Dedicated authenticated fixture: terminate this sleeping controller.
        // The broker alarm must restore traffic without any Workflow cleanup.
        await step.sleep("release:abandoned-controller", "2 minutes")
        throw new Error("Abandoned-controller fixture unexpectedly resumed")
      }
      const replay = await step.do("release:replay-10", noRetry, () => broker.promote(owner, 10))
      if (promoted.deployment.id !== replay.deployment.id || promoted.sequence !== replay.sequence) {
        throw new Error("Promotion replay created another deployment")
      }
    } finally {
      restored = await step.do("release:restore-baseline", noRetry, () => broker.rollback(owner))
    }
    if (restored.status !== "rolled-back" || restored.deployment.versions.length !== 1 ||
      restored.deployment.versions[0]?.version !== baseline || restored.deployment.versions[0]?.percentage !== 100) {
      throw new Error("Rollback allocation mismatch")
    }
    return { promoted: promoted.deployment, restored: restored.deployment, replayCreatedDeployment: false,
      credentialBoundary: "dedicated-worker-rpc", healthControllerVerified: false }
  }
}
