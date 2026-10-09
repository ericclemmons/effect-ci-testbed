import * as GitHub from "@effect-ci-testbed/github"
import { slackInteraction, type SlackApprovalEnvironment } from "./slack-interactions.ts"

export interface GitHubWorkflowParameters {
  readonly trigger: "github"
  readonly deliveryId: string
  readonly installationId: number
  readonly repository: string
  readonly repositoryName: string
  readonly ref?: string
  readonly revision: string
  readonly summaryCheckId: number
}

export interface RemoteWorkflowParameters {
  readonly trigger: "remote"
  readonly repository: string
  readonly ref?: string
  readonly revision: string
  readonly target?: string
}

export type WorkflowParameters = GitHubWorkflowParameters | RemoteWorkflowParameters

export interface WorkerEnvironment extends SlackApprovalEnvironment {
  /** Explicit cross-Worker binding; same-Worker requests use `ctx.exports`. */
  readonly EFFECT_CI?: Workflow<WorkflowParameters>
  readonly EFFECT_CI_API_TOKEN?: string
  readonly EFFECT_CI_DETAILS_URL?: string
  readonly EFFECT_CI_PUBLIC_URL?: string
  readonly DISCORD_WEBHOOK_URL?: string
  readonly SLACK_WEBHOOK_URL?: string
  readonly SLACK_BOT_TOKEN?: string
  readonly SLACK_CHANNEL_ID?: string
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
  readonly workflow?: (
    environment: WorkerEnvironment,
    context: ExecutionContext | undefined,
  ) => Workflow<WorkflowParameters>
}

interface RemoteRunRequest {
  readonly repository: string
  readonly revision: string
  readonly ref?: string
  readonly target?: string
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

export const approvalEventType = (requestId: string): string =>
  `approval-${requestId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`

const hex = (value: ArrayBuffer): string => Array.from(new Uint8Array(value))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("")

export const approvalToken = async (
  secret: string,
  instanceId: string,
  requestId: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${instanceId}:${requestId}`),
  )

  return hex(signature)
}

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

const isAuthorized = (request: Request, environment: WorkerEnvironment): boolean => {
  const token = environment.EFFECT_CI_API_TOKEN

  return token !== undefined && request.headers.get("authorization") === `Bearer ${token}`
}

const isApprovalAuthorized = async (
  request: Request,
  environment: WorkerEnvironment,
  instanceId: string,
  requestId: string,
): Promise<boolean> => {
  if (isAuthorized(request, environment)) return true
  if (!environment.EFFECT_CI_API_TOKEN) return false

  const supplied = new URL(request.url).searchParams.get("token")
  if (!supplied) return false

  const expected = await approvalToken(
    environment.EFFECT_CI_API_TOKEN,
    instanceId,
    requestId,
  )

  if (supplied.length !== expected.length) return false

  let difference = 0

  for (let index = 0; index < supplied.length; index++) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index)
  }

  return difference === 0
}

const readRemoteRun = async (request: Request): Promise<RemoteRunRequest | undefined> => {
  let value: unknown

  try {
    value = await request.json()
  } catch {
    return undefined
  }

  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>

  if (typeof record.repository !== "string" || typeof record.revision !== "string") {
    return undefined
  }

  if (record.ref !== undefined && typeof record.ref !== "string") return undefined
  if (record.target !== undefined && typeof record.target !== "string") return undefined

  return {
    repository: record.repository,
    revision: record.revision,
    ...(record.ref ? { ref: record.ref } : {}),
    ...(record.target ? { target: record.target } : {}),
  }
}

const remoteRun = async (
  request: Request,
  environment: WorkerEnvironment,
  workflow: Workflow<WorkflowParameters>,
): Promise<Response> => {
  if (!isAuthorized(request, environment)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const input = await readRemoteRun(request)

  if (!input) return new Response("Invalid remote run", { status: 400 })

  const instanceId = crypto.randomUUID()
  await workflow.create({
    id: instanceId,
    params: { trigger: "remote", ...input },
  })

  const origin = new URL(request.url).origin

  return Response.json({
    instanceId,
    eventsUrl: `${origin}/runs/${encodeURIComponent(instanceId)}/events`,
    statusUrl: `${origin}/runs/${encodeURIComponent(instanceId)}`,
  }, { status: 202 })
}

const streamEvents = async (
  request: Request,
  environment: WorkerEnvironment,
  workflow: Workflow<WorkflowParameters>,
  instanceId: string,
): Promise<Response> => {
  if (!isAuthorized(request, environment)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const cursorValue = new URL(request.url).searchParams.get("cursor")
  const cursor = cursorValue === null ? undefined : Number.parseInt(cursorValue, 10)
  const instance = await workflow.get(instanceId)
  const subscription = await instance.subscribe(
    cursor === undefined || Number.isNaN(cursor) ? undefined : { cursor },
  )
  const encoder = new TextEncoder()

  const body = new ReadableStream({
    async pull(controller) {
      try {
        const event = await subscription.next()

        if (event.done) {
          controller.close()
          subscription[Symbol.dispose]()
          return
        }

        controller.enqueue(encoder.encode(`${JSON.stringify(event.value)}\n`))
      } catch (error) {
        controller.error(error)
        subscription[Symbol.dispose]()
      }
    },
    cancel() {
      subscription[Symbol.dispose]()
    },
  })

  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson",
    },
  })
}

const resolveApproval = async (
  request: Request,
  environment: WorkerEnvironment,
  workflow: Workflow<WorkflowParameters>,
  instanceId: string,
  requestId: string,
): Promise<Response> => {
  const url = new URL(request.url)

  if (request.headers.get("origin") !== url.origin) {
    return new Response("Invalid origin", { status: 403 })
  }

  const form = await request.formData()
  const decision = form.get("decision")

  if (decision !== "approved" && decision !== "rejected") {
    return new Response("Invalid decision", { status: 400 })
  }

  const instance = await workflow.get(instanceId)
  const actor = request.headers.get("cf-access-authenticated-user-email")
  await instance.sendEvent({
    type: approvalEventType(requestId),
    payload: {
      decision,
      ...(actor ? { actor } : {}),
    },
  })

  return new Response(`Release ${decision}. You can close this tab.`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

export const worker = (options: WorkerOptions = {}) => {
  const github = options.github ?? defaultGitHubClient
  const getWorkflow = options.workflow ?? ((environment, context) => {
    const workflow = environment.EFFECT_CI ??
      (context?.exports as unknown as {
        readonly EffectCIWorkflow?: Workflow<WorkflowParameters>
      } | undefined)?.EffectCIWorkflow

    if (!workflow) throw new Error("EffectCIWorkflow is not exported or bound")

    return workflow
  })

  return ({
    async fetch(
      request: Request,
      environment: WorkerEnvironment,
      context?: ExecutionContext,
    ): Promise<Response> {
      const url = new URL(request.url)
      const workflow = getWorkflow(environment, context)

      if (request.method === "POST" && url.pathname === "/webhooks/slack") {
        return slackInteraction(request, environment, async (decision) => {
          const authorization = new URL(`/runs/${encodeURIComponent(decision.instanceId)}/approvals/${encodeURIComponent(decision.requestId)}`, url.origin)
          authorization.searchParams.set("token", decision.token)
          if (!await isApprovalAuthorized(new Request(authorization), environment, decision.instanceId, decision.requestId)) return false
          const instance = await workflow.get(decision.instanceId)
          const status = await instance.status()
          if (status.status !== "running" && status.status !== "waiting") return false
          await instance.sendEvent({ type: approvalEventType(decision.requestId), payload: { decision: decision.decision, actor: decision.actor } })

          return true
        })
      }

      if (request.method === "GET" && url.pathname === "/") {
        return Response.json({ service: "Effect CI", status: "ready" })
      }

      if (request.method === "POST" && url.pathname === "/runs") {
        return remoteRun(request, environment, workflow)
      }

      const eventRoute = url.pathname.match(/^\/runs\/([^/]+)\/events$/)

      if (request.method === "GET" && eventRoute) {
        return streamEvents(
          request,
          environment,
          workflow,
          decodeURIComponent(eventRoute[1]!),
        )
      }

      const statusRoute = url.pathname.match(/^\/runs\/([^/]+)$/)

      if (request.method === "GET" && statusRoute) {
        if (!isAuthorized(request, environment)) {
          return new Response("Unauthorized", { status: 401 })
        }

        const instance = await workflow.get(
          decodeURIComponent(statusRoute[1]!),
        )

        return Response.json(await instance.status())
      }

      const approvalRoute = url.pathname.match(/^\/runs\/([^/]+)\/approvals\/([^/]+)$/)

      if (approvalRoute) {
        const instanceId = decodeURIComponent(approvalRoute[1]!)
        const requestId = decodeURIComponent(approvalRoute[2]!)

        if (!await isApprovalAuthorized(
          request,
          environment,
          instanceId,
          requestId,
        )) {
          return new Response("Unauthorized", { status: 401 })
        }

        if (request.method === "GET") {
          const dashboard = detailsUrl(environment.EFFECT_CI_DETAILS_URL, instanceId)

          return dashboard ? new Response(null, { status: 302, headers: { location: dashboard, "referrer-policy": "no-referrer", "cache-control": "no-store" } }) : new Response("Use the approval buttons in Slack. Workflow dashboard URL is not configured.", { status: 503 })
        }
        if (request.method === "POST") {
          return resolveApproval(
            request,
            environment,
            workflow,
            instanceId,
            requestId,
          )
        }
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

      if (await existingInstance(workflow, deliveryId)) {
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
        await workflow.create({
          id: deliveryId,
          params: {
            trigger: "github",
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
