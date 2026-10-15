import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { ReviewedReleaseBroker } from "@effect-ci-testbed/cloudflare/reviewed-release";
import { assertRoutingDiagnosticPayload, runRoutingDiagnostic } from "./demo-routing-diagnostic.ts";

/** Private operator Workflow API only; fixed candidate/target and mandatory restoration. */
export class DemoRoutingDiagnosticWorkflow extends WorkflowEntrypoint<{ RELEASE_MANAGER: ReviewedReleaseBroker }> {
  override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    assertRoutingDiagnosticPayload(event.payload);
    return runRoutingDiagnostic(event.instanceId, step, this.env.RELEASE_MANAGER);
  }
}
