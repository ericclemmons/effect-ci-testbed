import * as GitHub from "@effect-ci-testbed/github"

export interface WorkflowParameters {
  readonly deliveryId: string
  readonly installationId: number
  readonly repository: string
  readonly repositoryName: string
  readonly ref?: string
  readonly revision: string
  readonly summaryCheckId: number
}

export interface WorkerEnvironment {
  readonly EFFECT_CI: Workflow<WorkflowParameters>
  readonly EFFECT_CI_DETAILS_URL?: string
  readonly GITHUB_APP_ID: string
  readonly GITHUB_PRIVATE_KEY: string
  readonly GITHUB_WEBHOOK_SECRET: string
}

export interface GitHubClient {
  readonly createInstallationToken: typeof GitHub.createInstallationToken
  readonly createCheck: typeof GitHub.createCheck
  readonly updateCheck: typeof GitHub.updateCheck
}

export interface WorkerOptions {
  readonly github?: GitHubClient
}

const defaultGitHubClient: GitHubClient = {
  createInstallationToken: GitHub.createInstallationToken,
  createCheck: GitHub.createCheck,
  updateCheck: GitHub.updateCheck,
}

const credentials = (environment: WorkerEnvironment): GitHub.GitHubAppCredentials => ({
  appId: environment.GITHUB_APP_ID,
  privateKey: environment.GITHUB_PRIVATE_KEY,
})

export const detailsUrl = (template: string | undefined, instanceId: string) =>
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

export const worker = (options: WorkerOptions = {}) => {
  const github = options.github ?? defaultGitHubClient

  return ({
    async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
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

      const token = await github.createInstallationToken(
        credentials(environment),
        payload.installation.id,
      )
      const checkDetailsUrl = detailsUrl(environment.EFFECT_CI_DETAILS_URL, deliveryId)
      const check = await github.createCheck({
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
            ...(payload.check_suite.head_branch
              ? { ref: `refs/heads/${payload.check_suite.head_branch}` }
              : {}),
            revision: payload.check_suite.head_sha,
            summaryCheckId: check.id,
          },
        })
      } catch (error) {
        await github.updateCheck({
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
  }) satisfies ExportedHandler<WorkerEnvironment>
}
