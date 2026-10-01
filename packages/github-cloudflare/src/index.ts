import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as GitHub from "@effect-ci-testbed/github"
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"

export interface Environment extends Cloudflare.WorkflowEnvironment {
  readonly EFFECT_CI: Workflow<WorkflowParameters>
  readonly EFFECT_CI_DETAILS_URL?: string
  readonly GITHUB_APP_ID: string
  readonly GITHUB_PRIVATE_KEY: string
  readonly GITHUB_WEBHOOK_SECRET: string
}

export interface WorkflowParameters extends Cloudflare.WorkflowParameters {
  readonly deliveryId: string
  readonly installationId: number
  readonly repositoryName: string
  readonly summaryCheckId: number
}

const credentials = (environment: Environment): GitHub.GitHubAppCredentials => ({
  appId: environment.GITHUB_APP_ID,
  privateKey: environment.GITHUB_PRIVATE_KEY,
})

const detailsUrl = (template: string | undefined, instanceId: string) =>
  template?.replaceAll("{id}", encodeURIComponent(instanceId))

const existingInstance = async (
  workflow: Workflow<WorkflowParameters>,
  id: string,
): Promise<boolean> => {
  try {
    const instance = await workflow.get(id)
    await instance.status()

    return true
  } catch {
    return false
  }
}

export const worker = () => ({
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({ service: "Effect CI", status: "ready" })
    }

    if (request.method !== "POST" || url.pathname !== "/webhooks/github") {
      return new Response("Not found", { status: 404 })
    }

    if (!environment.GITHUB_WEBHOOK_SECRET) {
      return new Response("GITHUB_WEBHOOK_SECRET is not configured", { status: 503 })
    }

    const body = await request.text()
    const valid = await GitHub.verifyWebhookSignature(
      environment.GITHUB_WEBHOOK_SECRET,
      body,
      request.headers.get("x-hub-signature-256"),
    )

    if (!valid) return new Response("Invalid signature", { status: 401 })
    if (request.headers.get("x-github-event") !== "check_suite") {
      return Response.json({ accepted: false, reason: "ignored event" }, { status: 202 })
    }

    let value: unknown

    try {
      value = JSON.parse(body)
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const payload = GitHub.parseCheckSuiteWebhook(value)

    if (!payload) {
      return Response.json({ accepted: false, reason: "ignored action" }, { status: 202 })
    }

    const deliveryId = request.headers.get("x-github-delivery")

    if (!deliveryId) return new Response("Missing X-GitHub-Delivery", { status: 400 })

    if (await existingInstance(environment.EFFECT_CI, deliveryId)) {
      return Response.json({ accepted: true, duplicate: true, instanceId: deliveryId }, { status: 202 })
    }

    const token = await GitHub.createInstallationToken(
      credentials(environment),
      payload.installation.id,
    )
    const checkDetailsUrl = detailsUrl(environment.EFFECT_CI_DETAILS_URL, deliveryId)
    const check = await GitHub.createCheck({
      token,
      repository: payload.repository.full_name,
      sha: payload.check_suite.head_sha,
      name: "Effect CI / Cloudflare",
      title: "Effect CI is queued on Cloudflare",
      summary: "A native Cloudflare Workflow has been requested for this commit.",
      status: "queued",
      externalId: deliveryId,
      ...(checkDetailsUrl ? { detailsUrl: checkDetailsUrl } : {}),
    })

    try {
      await environment.EFFECT_CI.create({
        id: deliveryId,
        params: {
          deliveryId,
          installationId: payload.installation.id,
          repository: payload.repository.clone_url,
          repositoryName: payload.repository.full_name,
          revision: payload.check_suite.head_sha,
          summaryCheckId: check.id,
        },
      })
    } catch (error) {
      await GitHub.updateCheck({
        token,
        repository: payload.repository.full_name,
        checkId: check.id,
        title: "Effect CI failed to start on Cloudflare",
        summary: error instanceof Error ? error.message : String(error),
        conclusion: "failure",
      })
      throw error
    }

    return Response.json({ accepted: true, instanceId: deliveryId }, { status: 202 })
  },
}) satisfies ExportedHandler<Environment>

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
