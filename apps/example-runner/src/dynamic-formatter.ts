import * as CI from "@effect-ci-testbed/ci"
import * as Dynamic from "@effect-ci-testbed/cloudflare-dynamic-worker"
import * as Tools from "@effect-ci-testbed/source-tools"
import * as Effect from "effect/Effect"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import workflow from "../../../examples/dynamic-worker-checks/.cloudflare/ci/workflow.ts"

interface Parameters {
  readonly repository: string
  readonly revision: string
}

/** Source retrieval and tools use Workers only: no Container or workspace snapshot. */
export class DynamicFormatterWorkflow extends WorkflowEntrypoint<{ LOADER: WorkerLoader }, Parameters> {
  override async run(event: Readonly<WorkflowEvent<Parameters>>, step: WorkflowStep) {
    const repository = new URL(event.payload.repository)
    if (repository.origin !== "https://github.com" || !/^[a-f0-9]{40}$/.test(event.payload.revision)) {
      throw new Error("Source-only proof requires a GitHub repository and immutable full commit SHA")
    }
    const project = repository.pathname.replace(/\.git$/, "")
    const tools = Dynamic.makeSourceTools(this.env.LOADER)
    const result = await CI.runPromise({
      ...workflow,
      effect: workflow.effect.pipe(Effect.provideService(Tools.SourceTools, {
        format: (request) => Effect.tryPromise(() => step.do("dynamic-worker:format", () =>
          Effect.runPromise(tools.format(request)))),
      })),
    }, {
      ci: true,
      env: "cloudflare-dynamic-worker",
      output: "silent",
      source: {
        checkout: () => Effect.succeed(CI.Workspace.remote("github-source", "examples/dynamic-worker-checks")),
        reference: { kind: "git", repository: event.payload.repository, revision: event.payload.revision },
      },
      workspaceFileSystem: {
        exists: () => Effect.fail(new Error("Source-only example does not require exists")),
        readFile: (workspace, path) => Effect.tryPromise(() => step.do("github-source:read", async () => {
          if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("Invalid source path")
          const response = await fetch(`https://raw.githubusercontent.com${project}/${event.payload.revision}/${workspace.cwd}/${path}`)
          if (!response.ok) throw new Error(`Source fetch failed: ${response.status}`)
          return response.text()
        })),
      },
      executor: { execute: () => Effect.die(new Error("Source-only workflow cannot execute commands")) },
    })
    return result.plan
  }
}
