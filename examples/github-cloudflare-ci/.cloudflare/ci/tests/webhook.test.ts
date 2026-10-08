import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import * as GitHubCloudflare from "@effect-ci-testbed/github-cloudflare/worker"

const deliveryId = "delivery-1"
const secret = "test-secret"
const payload = {
  action: "requested",
  check_suite: { head_branch: "feature", head_sha: "abc123" },
  installation: { id: 42 },
  repository: {
    clone_url: "https://github.com/example/project.git",
    full_name: "example/project",
  },
}
const body = JSON.stringify(payload)
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

const instances = new Map<string, GitHubCloudflare.WorkflowParameters>()
const checks: Array<Parameters<GitHubCloudflare.GitHubClient["createCheck"]>[0]> = []
const updates: Array<Parameters<GitHubCloudflare.GitHubClient["updateCheck"]>[0]> = []
const sentEvents: Array<{ readonly type: string; readonly payload: unknown }> = []

const application = GitHubCloudflare.worker({
  github: {
    createInstallationToken: async (_credentials, installationId) => {
      assert.equal(installationId, 42)

      return "installation-token"
    },
    createCheck: async (options) => {
      checks.push(options)

      return { id: 99, htmlUrl: "https://github.com/example/project/checks/99" }
    },
    updateCheck: async (options) => {
      updates.push(options)

      return { id: options.checkId, htmlUrl: "https://github.com/example/project/checks/99" }
    },
  },
})

const workflow = {
  create: async ({ id, params }: { id: string; params: GitHubCloudflare.WorkflowParameters }) => {
    instances.set(id, params)

    return { id }
  },
  get: async (id: string) => {
    if (!instances.has(id)) throw new Error("missing")

    const events = [
      { instanceId: id, eventId: 1, timestamp: 1, type: "workflow_started" },
      { instanceId: id, eventId: 2, timestamp: 2, type: "workflow_completed" },
    ]

    return {
      status: async () => ({ status: "running" }),
      sendEvent: async (event: { readonly type: string; readonly payload: unknown }) => {
        sentEvents.push(event)
      },
      subscribe: async () => ({
        [Symbol.dispose]() {},
        next: async () => {
          const value = events.shift()

          return value ? { done: false as const, value } : { done: true as const, value: undefined }
        },
      }),
    }
  },
}

const environment = {
  EFFECT_CI: workflow,
  GITHUB_APP_ID: "app-id",
  GITHUB_PRIVATE_KEY: "unused-by-fake-client",
  GITHUB_WEBHOOK_SECRET: secret,
} as unknown as GitHubCloudflare.WorkerEnvironment

const request = (id = deliveryId) => new Request("https://ci.example.com/webhooks/github", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-github-delivery": id,
    "x-github-event": "check_suite",
    "x-hub-signature-256": signature,
  },
  body,
})

const accepted = await application.fetch(request(), environment)

assert.equal(accepted.status, 202)
assert.deepEqual(await accepted.json(), {
  accepted: true,
  instanceId: deliveryId,
})
assert.equal(checks.length, 1)
assert.equal(checks[0]?.token, "installation-token")
assert.equal(checks[0]?.repository, "example/project")
assert.equal(checks[0]?.sha, "abc123")
assert.deepEqual(instances.get(deliveryId), {
  trigger: "github",
  deliveryId,
  installationId: 42,
  repository: "https://github.com/example/project.git",
  repositoryName: "example/project",
  ref: "refs/heads/feature",
  revision: "abc123",
  summaryCheckId: 99,
})

const duplicate = await application.fetch(request(), environment)

assert.equal(duplicate.status, 202)
assert.deepEqual(await duplicate.json(), {
  accepted: true,
  duplicate: true,
  instanceId: deliveryId,
})
assert.equal(checks.length, 1)
assert.equal(instances.size, 1)
assert.equal(updates.length, 0)

const failingEnvironment = {
  ...environment,
  EFFECT_CI: {
    create: async () => {
      throw new Error("Workflow unavailable")
    },
    get: async () => {
      throw new Error("missing")
    },
  },
} as unknown as GitHubCloudflare.WorkerEnvironment

await assert.rejects(
  application.fetch(request("delivery-failed"), failingEnvironment),
  /Workflow unavailable/,
)
assert.equal(checks.length, 2)
assert.equal(updates.length, 1)
assert.equal(updates[0]?.conclusion, "failure")
assert.equal(updates[0]?.summary, "Workflow unavailable")

const unauthorized = await application.fetch(new Request("https://ci.example.com/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ repository: "https://github.com/example/project.git", revision: "abc123" }),
}), environment)

assert.equal(unauthorized.status, 401)

const remoteEnvironment = {
  ...environment,
  EFFECT_CI_API_TOKEN: "remote-secret",
} as unknown as GitHubCloudflare.WorkerEnvironment
const remote = await application.fetch(new Request("https://ci.example.com/runs", {
  method: "POST",
  headers: {
    authorization: "Bearer remote-secret",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    repository: "https://github.com/example/project.git",
    revision: "abc123",
  }),
}), remoteEnvironment)

assert.equal(remote.status, 202)
const remoteRun = await remote.json() as { readonly instanceId: string; readonly eventsUrl: string }
assert.deepEqual(instances.get(remoteRun.instanceId), {
  trigger: "remote",
  repository: "https://github.com/example/project.git",
  revision: "abc123",
})

const stream = await application.fetch(new Request(remoteRun.eventsUrl, {
  headers: { authorization: "Bearer remote-secret" },
}), remoteEnvironment)

assert.equal(stream.status, 200)
assert.deepEqual(
  (await stream.text()).trim().split("\n").map((line) => JSON.parse(line).type),
  ["workflow_started", "workflow_completed"],
)

const requestId = "release:approve"
const approvalPath = `https://ci.example.com/runs/${remoteRun.instanceId}/approvals/${encodeURIComponent(requestId)}`
const signedToken = await GitHubCloudflare.approvalToken(
  "remote-secret",
  remoteRun.instanceId,
  requestId,
)
const review = await application.fetch(new Request(`${approvalPath}?token=${signedToken}`), remoteEnvironment)

assert.equal(review.status, 200)
assert.match(await review.text(), /Approve release/)

const approval = await application.fetch(new Request(approvalPath, {
  method: "POST",
  headers: {
    authorization: "Bearer remote-secret",
    "cf-access-authenticated-user-email": "reviewer@example.com",
    "content-type": "application/x-www-form-urlencoded",
    origin: "https://ci.example.com",
  },
  body: "decision=approved",
}), remoteEnvironment)

assert.equal(approval.status, 200)
assert.deepEqual(sentEvents.at(-1), {
  type: GitHubCloudflare.approvalEventType(requestId),
  payload: { decision: "approved", actor: "reviewer@example.com" },
})
