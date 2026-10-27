import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers"

import workflow from "../.cloudflare/ci/workflow.ts"

export class WorkspaceContainer extends Cloudflare.WorkspaceContainer {
  private async armDeadline() {
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 10 * 60_000)
    }
  }

  override async checkout(...args: Parameters<Cloudflare.WorkspaceContainer["checkout"]>) {
    await this.armDeadline()
    return super.checkout(...args)
  }

  override async execute(...args: Parameters<Cloudflare.WorkspaceContainer["execute"]>) {
    await this.armDeadline()
    return super.execute(...args)
  }

  async stop() {
    if (this.ctx.container?.running) await this.ctx.container.destroy("Docker recipe finished")
    await this.ctx.storage.deleteAlarm()
  }

  override async alarm() { await this.stop() }
}

export default {
  fetch() {
    return new Response("Effect CI Docker-in-Docker example")
  },
}

const Base = Cloudflare.workflowEntrypoint(workflow, {
  container: {
    entrypoint: ["/usr/local/bin/start-docker"],
    image: "workspace",
    instance: "standard-1",
    loginShell: false,
    readyCommand: "/usr/local/bin/docker-ready",
  },
  root: "examples/docker-in-docker",
  reuseWorkspace: false,
})

export class EffectCIWorkflow extends Base {
  override async run(event: WorkflowEvent<Cloudflare.WorkflowParameters>, step: WorkflowStep) {
    if (event.payload.repository !== "https://github.com/ericclemmons/effect-ci-testbed.git" ||
      !/^[a-f0-9]{40}$/.test(event.payload.revision)) throw Error("Use this recipe's public repository and a full commit SHA")
    let failed = false
    try {
      return await super.run(event, step)
    } catch (error) {
      failed = true
      throw error
    } finally {
      try {
        await step.do("docker:cleanup", { timeout: "30 seconds", retries: { limit: 0, delay: "1 second" } }, async () => {
          const binding = this.env.Workspace as unknown as DurableObjectNamespace<WorkspaceContainer>
          const results = await Promise.allSettled([event.instanceId, `${event.instanceId}:step=build and run user image`]
            .map(name => binding.getByName(name).stop()))
          if (results.some(result => result.status === "rejected")) throw Error("Docker workspace cleanup failed")
        })
      } catch (error) {
        if (!failed) throw error
        console.error("Docker cleanup failed after execution failure; inspect the cleanup checkpoint")
      }
    }
  }
}
