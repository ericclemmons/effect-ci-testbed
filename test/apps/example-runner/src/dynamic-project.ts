import * as CI from "@effect-ci-testbed/ci"
import * as Dynamic from "@effect-ci-testbed/cloudflare-dynamic-worker/project"
import * as Effect from "effect/Effect"
import { NonRetryableError } from "cloudflare:workflows"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import workflow from "../../../../examples/dynamic-project-checks/.cloudflare/ci/workflow.ts"

interface Parameters { readonly repository: string; readonly revision: string }

/** Fetch immutable source in the trusted host; the child receives only code and synthetic requests. */
export class DynamicProjectWorkflow extends WorkflowEntrypoint<{ LOADER: WorkerLoader }, Parameters> {
  override async run(event: Readonly<WorkflowEvent<Parameters>>, step: WorkflowStep) {
    if (typeof event.payload !== "object" || event.payload === null || typeof event.payload.repository !== "string"
      || typeof event.payload.revision !== "string") throw new NonRetryableError("Immutable GitHub source required")
    const repository = new URL(event.payload.repository)
    if (repository.origin !== "https://github.com" || repository.username || repository.password
      || repository.search || repository.hash || !/^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(repository.pathname)
      || !/^[a-f0-9]{40}$/.test(event.payload.revision)) throw new NonRetryableError("Immutable GitHub source required")
    const project = repository.pathname.replace(/\.git$/, "")
    const tools = Dynamic.makeProjectChecks(this.env.LOADER)
    const result = await CI.runPromise({ ...workflow, effect: workflow.effect.pipe(
      Effect.provideService(Dynamic.ProjectChecks, {
        run: (request) => Effect.tryPromise(() => step.do("dynamic-worker:project-checks", { retries: { limit: 0, delay: "1 second" } },
          async () => {
            try { return await Effect.runPromise(tools.run(request)) }
            catch { throw new NonRetryableError("Isolated project behavior check failed") }
          })),
      }),
    ) }, {
      ci: true, env: "cloudflare-dynamic-worker", output: "silent",
      source: {
        checkout: () => Effect.succeed(CI.Workspace.remote("immutable-project", "examples/dynamic-project-checks")),
        reference: { kind: "git", repository: event.payload.repository, revision: event.payload.revision },
      },
      workspaceFileSystem: {
        exists: () => Effect.fail(new Error("No filesystem capability")),
        readFile: (_, path) => Effect.tryPromise(() => step.do(`project-source:${path}`, async () => {
          if (!["app/index.js", "app/lib.js"].includes(path)) throw new NonRetryableError("Source path not allowed")
          const response = await fetch(`https://raw.githubusercontent.com${project}/${event.payload.revision}/examples/dynamic-project-checks/${path}`,
            { redirect: "manual", signal: AbortSignal.timeout(10_000) })
          if (!response.ok) throw new NonRetryableError(`Source fetch failed: ${response.status}`)
          return Dynamic.readBoundedText(response, Dynamic.projectPolicy.maxSourceBytes)
        })),
      },
      executor: { execute: () => Effect.die(new Error("Project checks cannot execute container commands")) },
    })
    return result.plan
  }
}
