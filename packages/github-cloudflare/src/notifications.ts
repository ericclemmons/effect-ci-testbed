import type { RuntimeEvent } from "@effect-ci-testbed/ci"
import type { SlackBlock } from "./run-card.ts"

export interface NotificationChannels {
  readonly DISCORD_WEBHOOK_URL?: string
  readonly SLACK_WEBHOOK_URL?: string
  readonly SLACK_BOT_TOKEN?: string
  readonly SLACK_CHANNEL_ID?: string
}

export const hasNotificationChannels = (channels: NotificationChannels): boolean =>
  Boolean(channels.DISCORD_WEBHOOK_URL || channels.SLACK_WEBHOOK_URL ||
    (channels.SLACK_BOT_TOKEN && channels.SLACK_CHANNEL_ID))

export interface NotificationResult {
  readonly delivered: number
  readonly failed: number
  readonly slackMessageTs?: string
  readonly discordMessageId?: string
}

/** Deliberately excludes command output, payloads, credentials, and error bodies. */
export const notificationText = (event: RuntimeEvent): string | undefined => {
  switch (event.type) {
    case "workflow.started":
      return `CI ${event.workflowId}: started`
    case "workflow.completed":
      return `CI ${event.workflowId}: ${event.conclusion}`
    case "step.status":
      if (event.status === "planned" || event.status === "queued") return undefined

      return `CI ${event.workflowId}: ${event.stepId} — ${event.status}${event.optional ? " (optional)" : ""}`
    case "approval.resolved":
      return `CI ${event.workflowId}: ${event.stepId} — ${event.decision}`
    case "approval.requested":
      return `CI ${event.workflowId}: ${event.stepId} — waiting for approval`
    default:
      return undefined
  }
}

/** Webhook URLs are Worker secrets, never workflow parameters or container input. */
export const sendNotification = async (
  channels: NotificationChannels,
  text: string,
  transport: typeof fetch = fetch,
  slackMessageTs?: string,
  blocks?: ReadonlyArray<SlackBlock>,
  discordMessageId?: string,
): Promise<NotificationResult> => {
  const slackBot = Boolean(channels.SLACK_BOT_TOKEN && channels.SLACK_CHANNEL_ID)
  const endpoints = [
    { provider: "discord", url: channels.DISCORD_WEBHOOK_URL },
    { provider: "slack", url: slackBot ? undefined : channels.SLACK_WEBHOOK_URL },
    { provider: "slack-bot", url: slackBot
      ? `https://slack.com/api/${slackMessageTs ? "chat.update" : "chat.postMessage"}`
      : undefined },
  ] as const
  let messageTs: string | undefined
  let messageId: string | undefined
  const results = await Promise.all(endpoints.filter((entry) => entry.url).map(async (entry) => {
    try {
      const url = new URL(entry.url!)
      if (url.protocol !== "https:") throw new Error("HTTPS required")
      if (entry.provider === "discord") {
        if (discordMessageId) url.pathname = `${url.pathname.replace(/\/$/, "")}/messages/${encodeURIComponent(discordMessageId)}`
        else url.searchParams.set("wait", "true")
      }

      const response = await transport(url, {
        method: entry.provider === "discord" && discordMessageId ? "PATCH" : "POST",
        headers: {
          "content-type": "application/json",
          ...(entry.provider === "slack-bot"
            ? { authorization: `Bearer ${channels.SLACK_BOT_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify(entry.provider === "discord"
          ? { content: text.slice(0, 2000), allowed_mentions: { parse: [] } }
          : {
            ...(entry.provider === "slack-bot" ? {
              channel: channels.SLACK_CHANNEL_ID,
              ...(slackMessageTs ? { ts: slackMessageTs } : {}),
              text: text.slice(0, 3000),
              parse: "none",
              unfurl_links: false,
              unfurl_media: false,
            } : {}),
            blocks: blocks ?? [{ type: "section", text: { type: "plain_text", text: text.slice(0, 3000) } }],
          }),
      })
      if (entry.provider === "slack-bot") {
        const body = await response.json() as { ok?: boolean; ts?: string }
        if (!response.ok || body.ok !== true || typeof body.ts !== "string") return false
        messageTs = body.ts

        return true
      }
      if (entry.provider === "discord" && response.ok && response.status !== 204) {
        const body = await response.json() as { id?: string }
        if (typeof body.id !== "string") return false
        messageId = body.id

        return true
      }
      await response.body?.cancel()

      return response.ok
    } catch {
      // Do not log transport errors: they may contain the secret webhook URL.
      return false
    }
  }))

  return {
    delivered: results.filter(Boolean).length,
    failed: results.filter((ok) => !ok).length,
    ...(messageTs ? { slackMessageTs: messageTs } : {}),
    ...(messageId ? { discordMessageId: messageId } : {}),
  }
}
