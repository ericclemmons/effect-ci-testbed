import { Sandbox } from "@cloudflare/sandbox"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as CI from "@effect-ci-testbed/ci"
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"

import workflow from "../.cloudflare/workflows/build.ts"

interface WorkflowParameters {
  readonly repository: string
  readonly revision: string
}

interface Env {
  readonly Sandbox: DurableObjectNamespace<Sandbox>
}

export { Sandbox }

export default {
  fetch() {
    return new Response("Effect CI Cloudflare runner")
  },
}

export class EffectCIWorkflow extends WorkflowEntrypoint<Env, WorkflowParameters> {
  override async run(
    event: Readonly<WorkflowEvent<WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    const runner = Cloudflare.makeRunner({
      binding: this.env.Sandbox,
      repository: event.payload.repository,
      revision: event.payload.revision,
      sandboxId: event.instanceId,
      step,
    })

    const result = await CI.runPromise(workflow, {
      env: "cloudflare",
      event: { type: "workflow_dispatch", payload: event.payload },
      executor: runner.executor,
      source: runner.source,
    })

    return result.plan
  }
}
