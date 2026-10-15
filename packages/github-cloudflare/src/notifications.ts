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
  /** Host-only bounded metadata, never upstream error text. */
  readonly slackFailure?: "invalid_blocks" | "rejected" | "http" | "transport" | "invalid-ack"
  readonly slackImageValidationRetries?: number
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
  options: { readonly privateImageValidation?: boolean; readonly wait?: (milliseconds: number) => Promise<void> } = {},
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
  let slackFailure: NotificationResult["slackFailure"]
  let imageRetries = 0
  const results = await Promise.all(endpoints.filter((entry) => entry.url).map(async (entry) => {
    try {
      const url = new URL(entry.url!)
      if (url.protocol !== "https:") throw new Error("HTTPS required")
      if (entry.provider === "discord") {
        if (discordMessageId) url.pathname = `${url.pathname.replace(/\/$/, "")}/messages/${encodeURIComponent(discordMessageId)}`
        else url.searchParams.set("wait", "true")
      }

      const request = {
        method: entry.provider === "discord" && discordMessageId ? "PATCH" : "POST",
        headers: {
          "content-type": "application/json",
          ...(entry.provider === "slack-bot"
            ? { authorization: `Bearer ${channels.SLACK_BOT_TOKEN}` }
            : {}),
        },
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
      }
      // Only definite invalid_blocks rejection of a known message's private
      // image frame permits retry. The serialized body stays byte-identical.
      // Never retry a root post, HTTP/network error, lost ACK or other API error.
      const imageUpdate = options.privateImageValidation && entry.provider === "slack-bot" && Boolean(slackMessageTs) &&
        blocks?.some(block => block.type === "image" && block.slack_file)
      let response: Response
      let slackBody: { ok?: boolean; ts?: string; error?: string } | undefined
      for (let attempt = 0; ; attempt++) {
        response = await transport(url, { ...request, signal: AbortSignal.timeout(10_000) })
        if (entry.provider !== "slack-bot") break
        if (!response.ok) { await response.body?.cancel(); slackFailure = "http"; return false }
        slackBody = await response.json()
        if (slackBody?.ok === false && slackBody.error === "invalid_blocks" && imageUpdate && attempt < 3) {
          imageRetries++
          await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(500 * 2 ** attempt)
          continue
        }
        break
      }
      if (entry.provider === "slack-bot") {
        if (slackBody?.ok !== true || typeof slackBody.ts !== "string") {
          slackFailure = slackBody?.ok === false ? slackBody.error === "invalid_blocks" ? "invalid_blocks" : "rejected" : "invalid-ack"
          return false
        }
        messageTs = slackBody.ts

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
      if (entry.provider === "slack-bot") slackFailure = "transport"
      return false
    }
  }))

  return {
    delivered: results.filter(Boolean).length,
    failed: results.filter((ok) => !ok).length,
    ...(messageTs ? { slackMessageTs: messageTs } : {}),
    ...(messageId ? { discordMessageId: messageId } : {}),
    ...(options.privateImageValidation && slackFailure ? { slackFailure } : {}),
    ...(imageRetries ? { slackImageValidationRetries: imageRetries } : {}),
  }
}
