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

    return { status: async () => ({ status: "running" }) }
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
