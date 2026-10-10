import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as GitHub from "@effect-ci-testbed/github"
import * as Effect from "effect/Effect"
import { hasNotificationChannels, sendNotification } from "./notifications.ts"
import { RunCard } from "./run-card.ts"
import { Notifications, notificationLayer, type NotificationProvider } from "./notification-service.ts"
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import {
  approvalEventType,
  approvalToken,
  detailsUrl,
  type GitHubWorkflowParameters,
  type WorkerEnvironment,
  type WorkflowParameters,
} from "./worker.ts"
export { worker } from "./worker.ts"
export type {
  GitHubClient,
  GitHubWorkflowParameters,
  RemoteWorkflowParameters,
  WorkerEnvironment,
  WorkerOptions,
  WorkflowParameters,
} from "./worker.ts"

export interface Environment extends Cloudflare.WorkflowEnvironment, WorkerEnvironment {}

const credentials = (environment: Environment): GitHub.GitHubAppCredentials => ({
  appId: environment.GITHUB_APP_ID,
  privateKey: environment.GITHUB_PRIVATE_KEY,
})

export interface WorkflowEntrypointOptions extends Cloudflare.WorkflowEntrypointOptions<Environment> {
  /** Additional host-only destinations; credentials stay in provider closures. */
  readonly notificationProviders?: (environment: Environment, parameters: WorkflowParameters) => ReadonlyArray<NotificationProvider>
}

const isApprovalResult = (value: unknown): value is CI.ApprovalResult => {
  if (!value || typeof value !== "object") return false

  const record = value as Record<string, unknown>

  return (record.decision === "approved" || record.decision === "rejected") &&
    (record.actor === undefined || typeof record.actor === "string")
}

const approvalUrl = async (
  environment: Environment,
  instanceId: string,
  requestId: string,
): Promise<string | undefined> => {
  if (!environment.EFFECT_CI_PUBLIC_URL || !environment.EFFECT_CI_API_TOKEN) {
    return undefined
  }

  const origin = environment.EFFECT_CI_PUBLIC_URL.replace(/\/$/, "")
  const token = await approvalToken(
    environment.EFFECT_CI_API_TOKEN,
    instanceId,
    requestId,
  )

  return `${origin}/runs/${encodeURIComponent(instanceId)}/approvals/${encodeURIComponent(requestId)}?token=${token}`
}

const approvalHandler = (
  environment: Environment,
  instanceId: string,
  step: WorkflowStep,
  notify: (requestId: string, url: string) => Promise<void>,
): CI.ApprovalHandler => ({
  request: (request) => Effect.tryPromise({
    try: async () => {
      const url = await approvalUrl(environment, instanceId, request.requestId)

      if (hasNotificationChannels(environment) && url) {
        await notify(request.requestId, url)
      }

      const event = await step.waitForEvent<CI.ApprovalResult>(
        `approval:${request.stepId}`,
        {
          type: approvalEventType(request.requestId),
          timeout: "7 days",
        },
      )

      if (!isApprovalResult(event.payload)) {
        throw new Error(`Invalid approval response for ${request.stepId}`)
      }

      return event.payload
    },
    catch: (error) => error,
  }),
})

const isGitHubRun = (
  parameters: WorkflowParameters,
): parameters is GitHubWorkflowParameters => parameters.trigger === "github"

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
    const binding = this.env.Workspace ??
      (this.ctx.exports as unknown as {
        readonly WorkspaceContainer?: DurableObjectNamespace
      }).WorkspaceContainer

    if (!binding) {
      throw new Error("WorkspaceContainer is not exported or bound")
    }

    const github = isGitHubRun(event.payload) ? event.payload : undefined
    const token = github
      ? () => GitHub.createInstallationToken(credentials(this.env), github.installationId)
      : undefined
    const runner = Cloudflare.makeRunner({
      binding,
      cache: {
        key: github?.repositoryName ?? event.payload.repository,
        // Vite+ fingerprints task inputs itself; this is only its transport cache.
        keyFiles: [],
        paths: ["node_modules/.vite/task-cache"],
      },
      ...(options.container ? { container: options.container } : {}),
      repository: event.payload.repository,
      ...(options.root ? { root: options.root } : {}),
      ...(options.reuseWorkspace === undefined
        ? {}
        : { reuseWorkspace: options.reuseWorkspace }),
      revision: event.payload.revision,
      step,
      ...(token ? { token } : {}),
      workspaceId: event.instanceId,
    })
    let operation = 0
    const workflowDetailsUrl = detailsUrl(
      this.env.EFFECT_CI_DETAILS_URL,
      event.instanceId,
    )
    const reporter = github && token ? new GitHub.Reporter(
      {
        token: "",
        repository: github.repositoryName,
        sha: event.payload.revision,
        summaryCheckId: github.summaryCheckId,
        externalId: github.deliveryId,
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
    ) : undefined

    let slackMessageTs: string | undefined
    let discordMessageId: string | undefined
    let notificationQueue = Promise.resolve()
    const card = new RunCard({
      instanceId: event.instanceId,
      repository: github?.repositoryName ?? event.payload.repository,
      revision: event.payload.revision,
      slackApprovalsEnabled: Boolean(this.env.SLACK_SIGNING_SECRET && this.env.SLACK_APP_ID && this.env.SLACK_TEAM_ID && this.env.SLACK_APPROVER_IDS && this.env.SLACK_CHANNEL_ID),
      ...(workflowDetailsUrl ? { detailsUrl: workflowDetailsUrl } : {}),
    })
    const notificationProviders = options.notificationProviders?.(this.env, event.payload) ?? []
    const notifications = notificationLayer(notificationProviders, (provider, key, deliver) =>
      step.do(`notification-provider:${provider}:${key}`, deliver))
    const notify = (key: string, update: () => boolean): Promise<void> => {
      notificationQueue = notificationQueue.then(async () => {
        if (!update()) return
        const deliveries = await Effect.runPromise(Effect.gen(function*() {
          const service = yield* Notifications
          return yield* service.publish(key, card.snapshot())
        }).pipe(Effect.provide(notifications)))
        if (deliveries.some((delivery) => delivery.status === "failed")) {
          console.warn("CI notification provider delivery failed; execution continues")
        }
        if (!hasNotificationChannels(this.env)) return
        const presentation = card.render()
        const result = await step.do(`notification:${key}`, () => sendNotification(
          this.env,
          presentation.text,
          fetch,
          slackMessageTs,
          presentation.blocks,
          discordMessageId,
        ))
        slackMessageTs = result.slackMessageTs ?? slackMessageTs
        discordMessageId = result.discordMessageId ?? discordMessageId

        if (result.failed) console.warn("CI notification delivery failed; execution continues")
      })

      return notificationQueue
    }

    try {
      const result = await CI.runPromise(workflow, {
        approval: approvalHandler(this.env, event.instanceId, step, (requestId, url) =>
          notify(`${requestId}:review`, () => {
            card.setReviewUrl(url)

            return true
          })),
        ci: true,
        env: "cloudflare",
        event: {
          type: github ? "push" : "workflow_dispatch",
          payload: event.payload,
          ...(event.payload.ref ? { ref: event.payload.ref } : {}),
          revision: event.payload.revision,
          source: {
            kind: "git",
            repository: event.payload.repository,
            revision: event.payload.revision,
          },
        },
        executor: runner.executor,
        actionExecutor: runner.actionExecutor,
        onEvent: async (runtimeEvent: CI.RuntimeEvent) => {
          await reporter?.report(runtimeEvent)
          const key = runtimeEvent.type === "step.status"
              ? `${runtimeEvent.stepId}:${runtimeEvent.status}`
              : runtimeEvent.type === "approval.resolved"
                ? `${runtimeEvent.requestId}:${runtimeEvent.decision}`
                : runtimeEvent.type === "approval.requested"
                  ? `${runtimeEvent.requestId}:waiting`
                : runtimeEvent.type
          // Rebuild checklist state on replay and serialize concurrent edits.
          await notify(key, () => card.update(runtimeEvent))
        },
        output: "silent",
        ...(options.secrets ? { secrets: options.secrets(this.env) } : {}),
        source: runner.source,
        ...(options.checkCache
          ? { checkCache: options.checkCache(this.env) }
          : {}),
        workspacePersistence: runner.persistence,
      })

      return result.plan
    } catch (error) {
      await reporter?.abort()
      throw error
    }
  }
}

export { Cloudflare }
export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"
