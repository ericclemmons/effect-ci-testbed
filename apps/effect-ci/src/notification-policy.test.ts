import assert from "node:assert/strict"
import test from "node:test"
import { notificationChannels } from "./notification-policy.ts"
import { sendNotification } from "../../../packages/github-cloudflare/src/notifications.ts"
import type { WorkerEnvironment, WorkflowParameters } from "@effect-ci-testbed/github-cloudflare"

test("only the explicit release notification example posts; builds and duplicate suite runs stay quiet", async () => {
  const environment = { SLACK_BOT_TOKEN: "private", SLACK_CHANNEL_ID: "C1" } as WorkerEnvironment
  const calls: string[] = []
  const transport = (async (url) => {
    calls.push(String(url))
    return Response.json({ ok: true, ts: "123.456" })
  }) as typeof fetch
  for (const parameters of [
    { trigger: "github" }, { trigger: "github" },
    { trigger: "remote" }, { trigger: "remote", target: "build" },
  ]) {
    await sendNotification(notificationChannels(environment, parameters as WorkflowParameters), "build", transport)
  }
  assert.equal(calls.length, 0)
  const channels = notificationChannels(environment, { trigger: "remote", repository: "owner/repo", revision: "abc123", target: "release" })
  const initial = await sendNotification(channels, "queued", transport)
  await sendNotification(channels, "running", transport, initial.slackMessageTs)
  await sendNotification(channels, "complete", transport, initial.slackMessageTs)
  assert.deepEqual(calls, ["https://slack.com/api/chat.postMessage", "https://slack.com/api/chat.update", "https://slack.com/api/chat.update"])
  assert.equal(environment.SLACK_BOT_TOKEN, "private") // Filtering does not disable callback authentication.
})
