import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import * as CI from "@effect-ci-testbed/ci"
import { makeRunner, WorkspaceContainer as BaseWorkspaceContainer } from "@effect-ci-testbed/cloudflare"
import { snapshotDeployment, type SnapshotBaselineStore, type DeploymentVerification } from "@effect-ci-testbed/cloudflare/snapshot-deployment"
import { outputManifestDigest } from "@effect-ci-testbed/cloudflare/output-manifest"
import * as Effect from "effect/Effect"
import { servingPolicy, sha256 } from "./site.ts"
export { Site } from "./site.ts"
export { SnapshotDeploymentBaselines } from "@effect-ci-testbed/cloudflare/snapshot-deployment"

interface SiteCapability {
  publish(owner: string, body: string): Promise<string>
  verifyCurrent(request: DeploymentVerification): Promise<boolean>
  fetch(request: Request): Promise<Response>
}
interface Exports {
  WorkspaceContainer: DurableObjectNamespace<WorkspaceContainer>
  Site: { getByName(name: string): SiteCapability }
  SnapshotDeploymentBaselines: { getByName(name: string): SnapshotBaselineStore }
}
interface Environment { SOURCE_ROOT: string }
interface Parameters { repository: string; revision: string }
const patterns = ["dist/**"]

export class WorkspaceContainer extends BaseWorkspaceContainer {
  /** Explicit example lifecycle policy; does not retry commands or erase history. */
  async stop() { if (this.ctx.container?.running) await this.ctx.container.destroy("Snapshot-site run finished") }
}

export class SiteWorkflow extends WorkflowEntrypoint<Environment, Parameters> {
  override async run(event: WorkflowEvent<Parameters>, step: WorkflowStep) {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(event.payload.repository) || !/^[a-f0-9]{40}$/.test(event.payload.revision))
      throw Error("An explicit public GitHub repository and full commit are required")
    const exports = this.ctx.exports as unknown as Exports, owned = new Set<string>()
    const binding = { getByName: (name: string) => { owned.add(name); return exports.WorkspaceContainer.getByName(name) } } as unknown as DurableObjectNamespace
    const runner = makeRunner({ binding, step, workspaceId: event.instanceId, repository: event.payload.repository,
      revision: event.payload.revision, root: this.env.SOURCE_ROOT,
      container: { image: "workspace", instance: "standard-1", loginShell: false, readyCommand: "/usr/local/bin/node -e 'if(process.getuid()!==1000)process.exit(1)'" } })
    const site = exports.Site.getByName("production")
    const destination = snapshotDeployment({ destination: "site/production", configuration: servingPolicy, patterns, runner,
      baselines: exports.SnapshotDeploymentBaselines.getByName("site"), verifyCurrent: request => site.verifyCurrent(request) })
    const checkout = CI.action("checkout", function* () { return () => runner.source.checkout() })
    const build = CI.action("build", function* () { const workspace = yield* checkout(); return () => workspace.exec("node build.mjs") })
    const deploy = CI.action<{ receipt: string; baselineRecorded: boolean }>("deploy", function* () {
      const workspace = yield* build()
      return function* () {
        const output = yield* runner.outputs.inspect(workspace, patterns)
        if (output.manifest.files.length !== 1 || output.manifest.files[0]?.path !== "dist/index.html" || output.manifest.files[0].executable)
          return yield* Effect.fail(Error("This HTML example deploys exactly dist/index.html"))
        const body = yield* workspace.readFile("dist/index.html")
        const bytes = new TextEncoder().encode(body)
        if (body === undefined || bytes.length > 64 * 1024 || (yield* Effect.tryPromise(() => sha256(bytes))) !== output.manifest.files[0].sha256)
          return yield* Effect.fail(Error("Built HTML byte identity mismatch"))
        const receipt = yield* Effect.tryPromise(() => site.publish(event.instanceId, body))
        const digest = yield* Effect.tryPromise(() => outputManifestDigest(output.manifest))
        if (!(yield* Effect.tryPromise(() => site.verifyCurrent({ destination: "site/production", configuration: servingPolicy,
          receipt, manifest: output.manifest, digest })))) return yield* Effect.fail(Error("Site publication is not current"))
        return { receipt, baselineRecorded: yield* destination.recordSuccessful(workspace, receipt) }
      }
    }, { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" })
    const program = CI.workflow("snapshot-site", function* () {
      const workspace = yield* build()
      if (yield* workspace.changed("dist/**")) yield* deploy()
      return workspace
    })
    try {
      const result = await Effect.runPromise(CI.run(program, { output: "silent", env: "cloudflare", source: runner.source,
        executor: runner.executor, actionExecutor: runner.actionExecutor, workspaceFileSystem: runner.fileSystem,
        workspacePersistence: runner.persistence, workspaceChanges: destination.changes }))
      return result.plan
    } finally {
      await step.do("cleanup", { timeout: "30 seconds", retries: { limit: 0, delay: "1 second", backoff: "constant" } },
        async () => { for (const name of owned) await exports.WorkspaceContainer.getByName(name).stop() })
    }
  }
}

export default { fetch(request: Request, _environment: Environment, context: { exports: Exports }) {
  return context.exports.Site.getByName("production").fetch(request)
} }
