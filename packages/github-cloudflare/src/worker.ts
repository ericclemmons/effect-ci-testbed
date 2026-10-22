import * as GitHub from "@effect-ci-testbed/github"
import * as Schema from "effect/Schema"
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
  /** Trusted host-selected dashboard link, never copied from webhook content. */
  readonly detailsUrl?: string
}

export interface RemoteWorkflowParameters {
  readonly trigger: "remote"
  readonly repository: string
  readonly ref?: string
  readonly revision: string
  readonly target?: string
  readonly targets?: ReadonlyArray<string>
  /** An explicit host-enrolled compute rerun, never an implicit retry. */
  readonly rerunFrom?: string
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
  /** Host-owned mount point; keeps dispatch/status/events on the selected workflow. */
  readonly routePrefix?: string
  /** Optional trusted host enrollment, checked after authentication and before creation. */
  readonly remoteRunAllowed?: (input: RemoteRunRequest) => boolean
  /** Explicit host opt-in; selected goals must be consumed by its workflow factory. */
  readonly remoteTargets?: ReadonlyArray<string>
  /** Discover selected goals inside the isolated project CLI, never in the host. */
  readonly remoteTargetDiscovery?: "project"
  /** The terminal status contains public execution evidence for the CLI. */
  readonly remoteResult?: boolean
  readonly remoteRerun?: boolean
  /** Authenticated read-only projection. Return public observations, never
   * private attempt outputs, provider capabilities, keys or project code. */
  readonly executionHistory?: (input: { readonly revision: string; readonly after?: string },
    environment: WorkerEnvironment, context: ExecutionContext | undefined) => Promise<unknown>
  /** Declaration only; the trusted host must independently enforce each method. */
  readonly remoteAuthentication?: ReadonlyArray<"api-token" | "cloudflare-access-identity">
  readonly github?: GitHubClient
  /** Explicit signed-push enrollment. Unlike check suites, undefined declines
   * the event: raw pushes never fall through to a default workflow. */
  readonly githubPushRun?: (identity: Omit<GitHubWorkflowParameters, "summaryCheckId" | "detailsUrl">, environment: WorkerEnvironment, context: ExecutionContext | undefined) =>
    { readonly workflow: Workflow<WorkflowParameters>; readonly detailsUrl?: string } | false | undefined
  /** Trusted routing AFTER signature/App validation. False declines the event;
   * undefined keeps the default workflow for hosts without explicit enrollment. */
  readonly githubRun?: (identity: Omit<GitHubWorkflowParameters, "summaryCheckId" | "detailsUrl">, environment: WorkerEnvironment, context: ExecutionContext | undefined) =>
    { readonly workflow: Workflow<WorkflowParameters>; readonly detailsUrl?: string } | false | undefined
  readonly workflow?: (
    environment: WorkerEnvironment,
    context: ExecutionContext | undefined,
  ) => Workflow<WorkflowParameters>
}

const HistoryRevision = Schema.String.check(Schema.isLowercased(), Schema.isLengthBetween(40, 40)).pipe(
  Schema.decodeTo(Schema.Uint8ArrayFromHex.check(Schema.isLengthBetween(20, 20))),
)
const HistoryCursor = Schema.String.check(Schema.isLowercased(), Schema.isLengthBetween(64, 64)).pipe(
  Schema.decodeTo(Schema.Uint8ArrayFromHex.check(Schema.isLengthBetween(32, 32))),
)
const HistoryQuery = Schema.Struct({ revision: HistoryRevision, after: Schema.optionalKey(HistoryCursor) })

export interface RemoteRunRequest {
  readonly repository: string
  readonly revision: string
  readonly ref?: string
  readonly target?: string
  readonly targets?: ReadonlyArray<string>
  readonly rerunFrom?: string
}

const selectedTargets = (input: { readonly target?: unknown; readonly targets?: unknown }): ReadonlyArray<string> | undefined => {
  if (input.target === undefined && input.targets === undefined) return undefined
  if (input.target !== undefined && input.targets !== undefined) throw Error("Invalid remote goals")
  const values = input.targets === undefined ? [input.target] : input.targets
  if (!Array.isArray(values) || values.length < 1 || values.length > 16 ||
      values.some(value => typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,63}$/.test(value)) ||
      new Set(values).size !== values.length) throw Error("Invalid remote goals")
  return Object.freeze([...values])
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
  let selection: ReadonlyArray<string> | undefined
  try { selection = selectedTargets(record) } catch { return undefined }
  if (record.rerunFrom !== undefined && !Schema.is(Schema.String.check(Schema.isUUID(undefined)))(record.rerunFrom)) return undefined

  return {
    repository: record.repository,
    revision: record.revision,
    ...(record.ref ? { ref: record.ref } : {}),
    ...(record.target ? { target: record.target } : {}),
    ...(record.targets === undefined ? {} : { targets: selection! }),
    ...(record.rerunFrom === undefined ? {} : { rerunFrom: record.rerunFrom as string }),
  }
}

const remoteRun = async (
  request: Request,
  environment: WorkerEnvironment,
  workflow: Workflow<WorkflowParameters>,
  options: Pick<WorkerOptions, "routePrefix" | "remoteRunAllowed" | "remoteTargets" | "remoteTargetDiscovery" | "remoteResult" | "remoteRerun"> = {},
): Promise<Response> => {
  if (!isAuthorized(request, environment)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const input = await readRemoteRun(request)

  if (!input) return new Response("Invalid remote run", { status: 400 })
  if (input.rerunFrom !== undefined && (!options.remoteRerun || !input.target && !input.targets))
    return new Response("Compute rerun is not enrolled", { status: 403 })
  const selection = selectedTargets(input)
  if (selection && options.remoteTargetDiscovery !== "project" &&
      (!options.remoteTargets || selection.some(target => !options.remoteTargets!.includes(target)))) {
    return new Response("Remote goals are not enrolled", { status: 403 })
  }
  if (options.remoteRunAllowed && !options.remoteRunAllowed(input)) {
    return new Response("Remote workflow is not enrolled for these inputs", { status: 403 })
  }

  const instanceId = crypto.randomUUID()
  await workflow.create({
    id: instanceId,
    params: { trigger: "remote", ...input },
  })

  const origin = new URL(request.url).origin + (options.routePrefix ?? "")

  return Response.json({
    instanceId,
    eventsUrl: `${origin}/runs/${encodeURIComponent(instanceId)}/events`,
    statusUrl: `${origin}/runs/${encodeURIComponent(instanceId)}`,
    ...(options.remoteResult ? { resultAvailable: true } : {}),
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
  const prefix = options.routePrefix ?? ""
  if ((options.remoteTargetDiscovery !== undefined && options.remoteTargetDiscovery !== "project") ||
      (options.remoteTargetDiscovery && options.remoteTargets !== undefined)) {
    throw new Error("Choose fixed remote targets or project discovery")
  }
  const remoteTargets = options.remoteTargets === undefined ? Object.freeze([] as string[]) : selectedTargets({ targets: options.remoteTargets })!
  if (prefix !== "" && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix)) {
    throw new Error("Invalid workflow route prefix")
  }
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
      if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
        return new Response("Not found", { status: 404 })
      }
      const pathname = url.pathname.slice(prefix.length) || "/"
      if (request.method === "GET" && pathname === "/capabilities") {
        if (!isAuthorized(request, environment)) return new Response("Unauthorized", { status: 401 })
        return Response.json({ protocol: "effect-ci-remote-v1", targets: remoteTargets,
          ...(options.remoteTargetDiscovery ? { targetDiscovery: options.remoteTargetDiscovery } : {}),
          ...(options.remoteAuthentication ? { authentication: options.remoteAuthentication } : {}),
          ...(options.executionHistory ? { executionHistory: true } : {}),
          ...(options.remoteRerun ? { rerun: true } : {}),
        }, {
          headers: { "cache-control": "no-store" },
        })
      }
      if (request.method === "GET" && pathname === "/executions" && options.executionHistory) {
        if (!isAuthorized(request, environment)) return new Response("Unauthorized", { status: 401 })
        let input: typeof HistoryQuery.Encoded
        try {
          if (url.searchParams.getAll("revision").length !== 1 || url.searchParams.getAll("after").length > 1) throw Error()
          input = Schema.encodeSync(HistoryQuery)(Schema.decodeUnknownSync(HistoryQuery)({
            revision: url.searchParams.get("revision"),
            ...(url.searchParams.has("after") ? { after: url.searchParams.get("after") } : {}),
          }))
        } catch { return new Response("Invalid execution history request", { status: 400 }) }
        try {
          return Response.json(await options.executionHistory(input, environment, context), { headers: { "cache-control": "no-store" } })
        } catch { return new Response("Execution history unavailable", { status: 503 }) }
      }
      const workflow = getWorkflow(environment, context)

      if (request.method === "POST" && pathname === "/webhooks/slack") {
        return slackInteraction(request, environment, async (decision) => {
          const authorization = new URL(`${prefix}/runs/${encodeURIComponent(decision.instanceId)}/approvals/${encodeURIComponent(decision.requestId)}`, url.origin)
          authorization.searchParams.set("token", decision.token)
          if (!await isApprovalAuthorized(new Request(authorization), environment, decision.instanceId, decision.requestId)) return false
          const instance = await workflow.get(decision.instanceId)
          const status = await instance.status()
          if (status.status !== "running" && status.status !== "waiting") return false
          await instance.sendEvent({ type: approvalEventType(decision.requestId), payload: { decision: decision.decision, actor: decision.actor } })

          return true
        })
      }

      if (request.method === "GET" && pathname === "/") {
        return Response.json({ service: "Effect CI", status: "ready" })
      }

      if (request.method === "POST" && pathname === "/runs") {
        return remoteRun(request, environment, workflow, { ...options, remoteTargets })
      }

      const eventRoute = pathname.match(/^\/runs\/([^/]+)\/events$/)

      if (request.method === "GET" && eventRoute) {
        return streamEvents(
          request,
          environment,
          workflow,
          decodeURIComponent(eventRoute[1]!),
        )
      }

      const statusRoute = pathname.match(/^\/runs\/([^/]+)$/)

      if (request.method === "GET" && statusRoute) {
        if (!isAuthorized(request, environment)) {
          return new Response("Unauthorized", { status: 401 })
        }

        const instance = await workflow.get(
          decodeURIComponent(statusRoute[1]!),
        )

        return Response.json(await instance.status())
      }

      const approvalRoute = pathname.match(/^\/runs\/([^/]+)\/approvals\/([^/]+)$/)

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

      if (request.method !== "POST" || pathname !== "/webhooks/github") {
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

      let value: unknown

      try {
        value = JSON.parse(body)
      } catch {
        return new Response("Invalid JSON", { status: 400 })
      }

      const deliveryId = request.headers.get("x-github-delivery")

      if (!deliveryId) return new Response("Missing X-GitHub-Delivery", { status: 400 })

      const event = request.headers.get("x-github-event")
      let identity: Omit<GitHubWorkflowParameters, "summaryCheckId" | "detailsUrl">
      let selection: ReturnType<NonNullable<WorkerOptions["githubRun"]>>

      if (event === "check_suite") {
        const payload = GitHub.parseCheckSuiteWebhook(value)
        if (!payload) return Response.json({ accepted: false, reason: "ignored action" }, { status: 202 })

        // Signed deliveries can describe another installed App's check suite.
        // Signature authenticates GitHub, not ownership by this App.
        if (String(payload.check_suite.app.id) !== environment.GITHUB_APP_ID) {
          return Response.json({ accepted: false, reason: "foreign check suite" }, { status: 202 })
        }
        identity = Object.freeze({
          trigger: "github" as const, deliveryId, installationId: payload.installation.id,
          repository: payload.repository.clone_url, repositoryName: payload.repository.full_name,
          ...(payload.check_suite.head_branch ? { ref: `refs/heads/${payload.check_suite.head_branch}` } : {}),
          revision: payload.check_suite.head_sha,
        })
        selection = options.githubRun?.(identity, environment, context)
      } else if (event === "push" && options.githubPushRun) {
        const payload = GitHub.parsePushWebhook(value)
        if (!payload) return Response.json({ accepted: false, reason: "ignored action" }, { status: 202 })
        identity = Object.freeze({
          trigger: "github" as const, deliveryId, installationId: payload.installation.id,
          repository: payload.repository.clone_url, repositoryName: payload.repository.full_name,
          ref: payload.ref, revision: payload.after,
        })
        selection = options.githubPushRun(identity, environment, context)
      } else {
        return Response.json({ accepted: false, reason: "ignored event" }, { status: 202 })
      }

      if (selection === false || event === "push" && selection === undefined) {
        return Response.json({ accepted: false, reason: "workflow not enrolled" }, { status: 202 })
      }
      const selectedWorkflow = selection?.workflow ?? workflow
      const checkDetailsUrl = selection?.detailsUrl ?? detailsUrl(environment.EFFECT_CI_DETAILS_URL, deliveryId)
      if (checkDetailsUrl) {
        const url = new URL(checkDetailsUrl)
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid host workflow details URL")
      }
      if (await existingInstance(selectedWorkflow, deliveryId)) {
        return Response.json({ accepted: true, duplicate: true, instanceId: deliveryId }, { status: 202 })
      }

      const token = await github.createInstallationToken(
        credentials(environment),
        identity.installationId,
      )
      const check = await github.createCheck({
        token,
        repository: identity.repositoryName,
        sha: identity.revision,
        name: "Effect CI / Cloudflare",
        title: "Effect CI is queued on Cloudflare",
        summary: "A native Cloudflare Workflow has been requested for this commit.",
        status: "queued",
        externalId: deliveryId,
        ...(checkDetailsUrl ? { detailsUrl: checkDetailsUrl } : {}),
      })

      try {
        await selectedWorkflow.create({
          id: deliveryId,
          params: {
            ...identity,
            ...(selection?.detailsUrl ? { detailsUrl: selection.detailsUrl } : {}),
            summaryCheckId: check.id,
          },
        })
      } catch (error) {
        await github.updateCheck({
          token,
          repository: identity.repositoryName,
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
