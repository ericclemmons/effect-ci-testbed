import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as GitHub from "@effect-ci-testbed/github"
import * as Effect from "effect/Effect"
import { hasNotificationChannels, sendNotification, type NotificationChannels } from "./notifications.ts"
import { RunCard, type SlackBlock } from "./run-card.ts"
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

export interface HostFinalization<A> {
  readonly environment: Environment
  readonly parameters: WorkflowParameters
  readonly instanceId: string
  readonly step: WorkflowStep
  /** Host-owned export capabilities, never exposed to project actions. */
  readonly exports: unknown
  readonly value: A
  readonly card: RunCard
  /** Update the SAME maintained message. Keys must be stable across Workflow replay. */
  readonly publish: (key: string, presentation?: { readonly text: string; readonly blocks: ReadonlyArray<SlackBlock> }) => Promise<void>
}

export interface WorkflowEntrypointOptions<A = unknown> extends Cloudflare.WorkflowEntrypointOptions<Environment> {
  /** Host policy chooses outbound channels per run, without removing approval credentials. */
  readonly notificationChannels?: (environment: Environment, parameters: WorkflowParameters) => NotificationChannels
  /** Additional host-only destinations; credentials stay in provider closures. */
  readonly notificationProviders?: (environment: Environment, parameters: WorkflowParameters) => ReadonlyArray<NotificationProvider>
  /** Trusted host continuation, outside CI actions. Success remains pending until it returns.
   * Use sibling step.do/waitForEvent calls for durable side effects; never uploaded project code.
   */
  readonly finalize?: (context: HostFinalization<A>) => Promise<void>
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
  workflow: CI.Workflow<A> | ((environment: Environment, parameters: WorkflowParameters) => CI.Workflow<A>),
  options: WorkflowEntrypointOptions<A> = {},
) => class GitHubCloudflareWorkflow extends WorkflowEntrypoint<
  Environment,
  WorkflowParameters
> {
  override async run(
    event: Readonly<WorkflowEvent<WorkflowParameters>>,
    step: WorkflowStep,
  ) {
    // Factories are trusted host code, never source uploaded by a remote caller.
    const definition = typeof workflow === "function" ? workflow(this.env, event.payload) : workflow
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
      ...(options.cache === false ? {} : { cache: options.cache ?? {
        key: github?.repositoryName ?? event.payload.repository,
        // Vite+ fingerprints task inputs itself; this is only its transport cache.
        keyFiles: [],
        paths: ["node_modules/.vite/task-cache"],
      } }),
      ...(options.container ? { container: options.container } : {}),
      repository: event.payload.repository,
      ...(options.root ? { root: options.root } : {}),
      ...(options.reuseWorkspace === undefined
        ? {}
        : { reuseWorkspace: options.reuseWorkspace }),
      revision: event.payload.revision,
      step,
      // Source credentials cannot write checks/comments or read another installed
      // repository. Reporting retains its independent host-only credential path.
      ...(github ? { token: () => GitHub.createInstallationToken(credentials(this.env), github.installationId, github.repositoryName.split("/")[1] ?? "") } : {}),
      workspaceId: event.instanceId,
    })
    let operation = 0
    const workflowDetailsUrl = detailsUrl(
      this.env.EFFECT_CI_DETAILS_URL,
      event.instanceId,
    )
    const reporter = github && token ? new GitHub.Reporter(
      {
        executionEnvironment: "Cloudflare",
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
    const channels = options.notificationChannels?.(this.env, event.payload) ?? this.env
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
    const notify = (key: string, update: () => boolean, override?: { readonly text: string; readonly blocks: ReadonlyArray<SlackBlock> }, required = false): Promise<void> => {
      notificationQueue = notificationQueue.then(async () => {
        if (!update()) return
        const deliveries = await Effect.runPromise(Effect.gen(function*() {
          const service = yield* Notifications
          return yield* service.publish(key, card.snapshot())
        }).pipe(Effect.provide(notifications)))
        if (deliveries.some((delivery) => delivery.status === "failed")) {
          console.warn("CI notification provider delivery failed; execution continues")
        }
        if (!hasNotificationChannels(channels)) return
        const presentation = override ?? card.render()
        const deliver = () => sendNotification(
          channels,
          presentation.text,
          fetch,
          slackMessageTs,
          presentation.blocks,
          discordMessageId,
        )
        const result = required
          ? await step.do(`notification:${key}`, { retries: { limit: 0, delay: "1 second" }, timeout: "20 seconds" }, deliver)
          : await step.do(`notification:${key}`, deliver)
        if (required && ((slackMessageTs && result.slackMessageTs !== slackMessageTs) ||
            (discordMessageId && result.discordMessageId !== discordMessageId)))
          throw new Error("Host finalization notification identity mismatch")
        slackMessageTs = result.slackMessageTs ?? slackMessageTs
        discordMessageId = result.discordMessageId ?? discordMessageId

        if (result.failed && required) throw new Error("Host finalization notification needs reconciliation")
        if (result.failed) console.warn("CI notification delivery failed; execution continues")
      })

      return notificationQueue
    }

    let deferredCompletion: Extract<CI.RuntimeEvent, { type: "workflow.completed" }> | undefined
    try {
      const result = await Effect.runPromise(Cloudflare.withWobsLogging(CI.run(definition, {
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
          if (options.finalize && runtimeEvent.type === "workflow.completed" && runtimeEvent.conclusion === "success") {
            deferredCompletion = runtimeEvent
            return
          }
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
        workspaceFileSystem: runner.fileSystem,
        ...(options.checkCache
          ? { checkCache: options.checkCache(this.env, { runner }) }
          : {}),
        workspacePersistence: runner.persistence,
      }), { workflow: definition.id, instance: event.instanceId }, this.env))

      if (options.finalize) {
        if (!deferredCompletion) throw new Error("Missing successful build completion")
        await options.finalize({
          environment: this.env, parameters: event.payload, instanceId: event.instanceId,
          step, exports: this.ctx.exports, value: result.value, card,
          publish: (key, presentation) => {
            if (!/^[A-Za-z0-9:_-]{1,128}$/.test(key)) throw new Error("Invalid host finalization notification key")
            // Never create a replacement review card after a lost/failed build-card ACK.
            if (!hasNotificationChannels(channels) ||
                (channels.SLACK_BOT_TOKEN && channels.SLACK_CHANNEL_ID && !slackMessageTs) ||
                (channels.SLACK_WEBHOOK_URL && !(channels.SLACK_BOT_TOKEN && channels.SLACK_CHANNEL_ID)))
              throw new Error("Host finalization requires an acknowledged maintained notification")
            return notify(`host-finalize:custom:${key}`, () => true, presentation, true)
          },
        })
        await reporter?.report(deferredCompletion)
        const completion = deferredCompletion
        await notify("host-finalize:completed", () => card.update(completion))
      }
      return result.plan
    } catch (error) {
      if (deferredCompletion) {
        const failure = { ...deferredCompletion, conclusion: "failure" as const }
        // Delivery failures must not replace the original release/controller failure.
        try { await reporter?.report(failure) } catch { /* abort below retains failure */ }
        notificationQueue = notificationQueue.catch(() => undefined)
        // A distinct terminal update to a known message is safe; never re-create an unacknowledged root.
        if (slackMessageTs || discordMessageId) {
          try { await notify("host-finalize:failed", () => card.update(failure), undefined, true) } catch { /* retain original */ }
        }
      }
      if (deferredCompletion) {
        try { await reporter?.abort() } catch { /* retain the original host failure */ }
      } else await reporter?.abort()
      throw error
    }
  }
}

export { Cloudflare }
export { WorkspaceContainer, GitCheckoutOutbound } from "@effect-ci-testbed/cloudflare"
