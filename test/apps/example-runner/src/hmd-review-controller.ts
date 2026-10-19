import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import type { ReleaseManager } from "../../release-manager/src/release-manager.ts"
import { runHumanReviewedHmd } from "./hmd-review-runner.ts"

export class HumanReviewedHmdWorkflow extends WorkflowEntrypoint<{
  RELEASE_MANAGER: Pick<ReleaseManager, "begin" | "promote" | "rollback" | "renew">
}> {
  override run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return runHumanReviewedHmd(event.instanceId, step, this.env.RELEASE_MANAGER,
      undefined, (message) => new NonRetryableError(message))
  }
}
