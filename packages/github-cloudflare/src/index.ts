import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as GitHub from "@effect-ci-testbed/github"
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { detailsUrl, type WorkerEnvironment, type WorkflowParameters } from "./worker.js"
export { worker } from "./worker.js"
export type { GitHubClient, WorkerEnvironment, WorkerOptions, WorkflowParameters } from "./worker.js"

export interface Environment extends Cloudflare.WorkflowEnvironment, WorkerEnvironment {}

const credentials = (environment: Environment): GitHub.GitHubAppCredentials => ({
  appId: environment.GITHUB_APP_ID,
  privateKey: environment.GITHUB_PRIVATE_KEY,
})

export interface WorkflowEntrypointOptions extends Cloudflare.WorkflowEntrypointOptions {}

export const workflowEntrypoint = <A>(
  workflow: CI.Workflow<A>,
  options: WorkflowEntrypointOptions = {},
) => class GitHubCloudflareWorkflow extends WorkflowEntrypoint<
  Environment,
  WorkflowParameters
> {
  override async run(
    event: Readonly<WorkflowEvent<WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    const githubCredentials = credentials(this.env)
    const token = () => GitHub.createInstallationToken(
      githubCredentials,
      event.payload.installationId,
    )
    const runner = Cloudflare.makeRunner({
      binding: this.env.Workspace,
      cache: {
        key: event.payload.repositoryName,
        paths: ["node_modules/.vite/task-cache"],
      },
      ...(options.container ? { container: options.container } : {}),
      repository: event.payload.repository,
      ...(options.reuseWorkspace === undefined
        ? {}
        : { reuseWorkspace: options.reuseWorkspace }),
      revision: event.payload.revision,
      step,
      token,
      workspaceId: event.instanceId,
    })
    let operation = 0
    const workflowDetailsUrl = detailsUrl(
      this.env.EFFECT_CI_DETAILS_URL,
      event.instanceId,
    )
    const reporter = new GitHub.Reporter(
      {
        token: "",
        repository: event.payload.repositoryName,
        sha: event.payload.revision,
        summaryCheckId: event.payload.summaryCheckId,
        externalId: event.payload.deliveryId,
        ...(workflowDetailsUrl ? { detailsUrl: workflowDetailsUrl } : {}),
      },
      {
        createCheck: (request) => step.do(
          `github:create-check:${operation++}`,
          async () => GitHub.createCheck({ ...request, token: await token() }),
        ),
        updateCheck: (request) => step.do(
          `github:update-check:${operation++}`,
          async () => GitHub.updateCheck({ ...request, token: await token() }),
        ),
      },
    )

    try {
      const result = await CI.runPromise(workflow, {
        env: "cloudflare",
        event: { type: "push", payload: event.payload },
        executor: runner.executor,
        onEvent: (runtimeEvent) => reporter.report(runtimeEvent),
        output: "silent",
        source: runner.source,
        workspacePersistence: runner.persistence,
      })

      return result.plan
    } catch (error) {
      await reporter.abort()
      throw error
    }
  }
}

export { Cloudflare }
export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"
