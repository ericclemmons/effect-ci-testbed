import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as CI from "@effect-ci-testbed/ci"
import { DurableObject, WorkerEntrypoint, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import { credentialRequest } from "../../../packages/cloudflare/src/credential-proxy.ts"
import workflow from "../../../examples/secret-outbound/.cloudflare/ci/workflow.ts"

// Non-production test credential: generated and retained only in host DO storage.
// Real services can replace this vault with Worker secrets or Secrets Store.
export class CredentialVault extends DurableObject {
  async credential(): Promise<string> {
    let token = await this.ctx.storage.get<string>("token")
    if (!token) {
      token = crypto.randomUUID()
      await this.ctx.storage.put("token", token)
    }
    return token
  }
  override async fetch(request: Request): Promise<Response> {
    return request.headers.get("authorization") === `Bearer ${await this.credential()}`
      ? new Response(null, { status: 200 }) : new Response(null, { status: 403 })
  }
}

export class SecretOutbound extends WorkerEntrypoint<unknown, { vaultId: string }> {
  override async fetch(request: Request): Promise<Response> {
    const vault = (this.ctx.exports as unknown as { CredentialVault: DurableObjectNamespace<CredentialVault> })
      .CredentialVault.getByName(this.ctx.props.vaultId)
    return credentialRequest(request, () => vault.credential(), (incoming) => vault.fetch(incoming))
  }
}

export class SecretWorkspaceContainer extends Cloudflare.WorkspaceContainer {
  protected override async configureOutbound(): Promise<void> {
    const outbound = (this.ctx.exports as unknown as {
      SecretOutbound: (options: { props: { vaultId: string } }) => Fetcher
    }).SecretOutbound({ props: { vaultId: this.ctx.id.toString() } })
    await this.ctx.container!.interceptOutboundHttp("credential.ci", outbound)
  }
}

export class SecretOutboundWorkflow extends WorkflowEntrypoint<unknown, Cloudflare.WorkflowParameters> {
  override async run(event: Readonly<WorkflowEvent<Cloudflare.WorkflowParameters>>, step: WorkflowStep) {
    const binding = (this.ctx.exports as unknown as { SecretWorkspaceContainer: DurableObjectNamespace }).SecretWorkspaceContainer
    const runner = Cloudflare.makeRunner({
      binding, step, workspaceId: event.instanceId, repository: event.payload.repository,
      revision: event.payload.revision, reuseWorkspace: false,
      container: { image: "workspace", instance: "standard-1" },
    })
    const result = await CI.runPromise(workflow, {
      ci: true, env: "cloudflare", output: "silent", source: runner.source,
      actionExecutor: runner.actionExecutor, executor: runner.executor,
      workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence,
    })
    return result.plan
  }
}
