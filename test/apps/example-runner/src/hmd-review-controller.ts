import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"
import { runHumanReviewedHmd } from "./hmd-review-runner.ts"
import { runWorkflowOutcomeFixture } from "./workflow-outcome-fixture.ts"
import { runWorkflowHealthController, type WorkflowHealthSource } from "../../../../packages/cloudflare/src/workflow-health-controller.ts"
import { sealWorkflowWindow, workflowWindowDigest, type WorkflowWindow } from "../../../../packages/cloudflare/src/workflow-window.ts"
import type { HealthPolicy } from "../../../../packages/cloudflare/src/health-gate.ts"
import { sendWorkflowHealthNotification } from "../../../../packages/github-cloudflare/src/workflow-health.ts"
import type { NotificationChannels } from "../../../../packages/github-cloudflare/src/notifications.ts"

interface WorkflowHealthParameters {
  readonly intent: "workflow-health-controller"
  readonly previous: WorkflowWindow
  readonly current: WorkflowWindow
  readonly policy: HealthPolicy
  readonly ownedMessage: { readonly slackMessageTs?: string; readonly discordMessageId?: string }
}

export class HumanReviewedHmdWorkflow extends WorkflowEntrypoint<{
  RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "promote" | "rollback" | "renew">
} & NotificationChannels> {
  override run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    const payload = event.payload as { intent?: string; mode?: "good" | "bad" | "reset-then-success" } | null
    if (payload?.intent === "workflow-outcome-fixture") {
      return runWorkflowOutcomeFixture(event.instanceId, step, payload.mode!)
    }
    if (payload?.intent === "workflow-window-admission") {
      const parameters = event.payload as { window: WorkflowWindow }
      const window = sealWorkflowWindow(parameters.window)
      if (event.instanceId !== window.admissionId || event.workflowName !== window.workflowName ||
        window.sealedAt > event.timestamp.getTime() || event.timestamp.getTime() > window.from) {
        throw new NonRetryableError("Workflow window must be admitted before execution")
      }
      return step.do("workflow-health:admission", { retries: { limit: 0, delay: "1 second" } }, async () => ({
        owner: event.instanceId, createdAt: event.timestamp.getTime(), digest: await workflowWindowDigest(window),
      }))
    }
    if (payload?.intent === "workflow-health-controller") {
      const parameters = event.payload as WorkflowHealthParameters
      const source: WorkflowHealthSource = {
        read: async (window, sequence) => {
          const side = window.windowId === parameters.previous.windowId ? "previous" : "current"
          const snapshot = await step.waitForEvent<string>(
            `workflow-health:receipt-${side}-${sequence}`, { type: `workflow-health-${side}-${sequence}`, timeout: "1 minute" })
          if (typeof snapshot.payload !== "string" || new TextEncoder().encode(snapshot.payload).byteLength > 512 * 1024) {
            throw new NonRetryableError("Workflow health snapshot exceeds checkpoint budget")
          }
          return JSON.parse(snapshot.payload) as Awaited<ReturnType<WorkflowHealthSource["read"]>>
        },
      }
      return runWorkflowHealthController(event.instanceId, step, parameters, parameters.policy, source,
        observation => sendWorkflowHealthNotification(this.env, observation, parameters.ownedMessage))
    }
    return runHumanReviewedHmd(event.instanceId, step, this.env.RELEASE_MANAGER,
      undefined, (message) => new NonRetryableError(message))
  }
}
