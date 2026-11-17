import type { WorkflowHealthObservation } from "../../cloudflare/src/workflow-health-controller.ts"
import { sendNotification, type NotificationChannels } from "./notifications.ts"

export function workflowHealthText(observation: WorkflowHealthObservation) {
  const lines = [`Workflow health: ${observation.decision.status} — ${observation.decision.reason}`,
    `Workflow: ${observation.currentWindow.workflowName}; window: ${observation.currentWindow.windowId}.`,
    "Versions below are Workflow versions, not Worker deployment versions."]
  for (const [label, window, evidence] of [["Previous", observation.previousWindow, observation.previous], ["Current", observation.currentWindow, observation.current]] as const) {
    lines.push(`${label}: ${window.version}; ${new Date(window.from).toISOString()} → ${new Date(window.to).toISOString()}.`)
    if (!evidence) { lines.push(`${label}: native evidence unavailable; no inferred successes.`); continue }
    lines.push(`${label}: ${evidence.sample.failures}/${evidence.sample.trials} observed logical failures; ${evidence.complete ? "closed cohort" : "uncertain coverage"}.`,
      `Deadlines: ${evidence.availability.status}; ${evidence.availability.missed.length} missed, ${evidence.availability.pending.length} pending, ${evidence.availability.unknown.length} unknown (${evidence.availability.overdueUnknown.length} overdue).`,
      `Evidence gaps: ${evidence.missing.length} missing, ${evidence.conflicts.length} conflicting, ${evidence.rejected + evidence.rejectedMetadata} rejected; saturated: ${evidence.saturated}.`)
  }
  lines.push("Deadline misses are availability signals, not invented terminal failures. Sparse data does not establish health.")
  return lines.join("\n")
}

export async function sendWorkflowHealthNotification(channels: NotificationChannels, observation: WorkflowHealthObservation,
  ownedMessage: { readonly slackMessageTs?: string; readonly discordMessageId?: string }, transport: typeof fetch = fetch) {
  if ((ownedMessage.slackMessageTs !== undefined && !/^\d+\.\d+$/.test(ownedMessage.slackMessageTs)) ||
    (ownedMessage.discordMessageId !== undefined && !/^\d+$/.test(ownedMessage.discordMessageId))) throw new Error("Invalid owned Workflow health message")
  const updates: NotificationChannels = {
    ...(ownedMessage.slackMessageTs && channels.SLACK_BOT_TOKEN && channels.SLACK_CHANNEL_ID ? {
      SLACK_BOT_TOKEN: channels.SLACK_BOT_TOKEN, SLACK_CHANNEL_ID: channels.SLACK_CHANNEL_ID,
    } : {}),
    ...(ownedMessage.discordMessageId && channels.DISCORD_WEBHOOK_URL ? { DISCORD_WEBHOOK_URL: channels.DISCORD_WEBHOOK_URL } : {}),
  }
  const result = await sendNotification(updates, workflowHealthText(observation), transport,
    ownedMessage.slackMessageTs, undefined, ownedMessage.discordMessageId)
  if (!result.delivered || result.failed) throw new Error("Workflow health notification unavailable")
  return result
}
