import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { Reporter } from "./reporter.ts"
import type { CreateCheckOptions, UpdateCheckOptions } from "./index.ts"

test("each step check shows the full graph, highlights itself, and links to its runner", async () => {
  const checkout = CI.action("checkout", () => function* () { return CI.Workspace.local("/tmp") })
  const build = CI.action("build", () => function* () { return yield* checkout() })
  const { plan } = await CI.runPromise(CI.workflow("context", () => build()), {
    mode: "plan", output: "silent",
  })
  const creates: CreateCheckOptions[] = []
  const updates: UpdateCheckOptions[] = []
  const detailsUrl = "https://dash.cloudflare.com/account/workers/workflows/ci/instance/run"
  const reporter = new Reporter({ token: "test", repository: "owner/repo", sha: "sha", detailsUrl }, {
    createCheck: async (request) => {
      creates.push(request)
      return { id: creates.length, htmlUrl: "https://github.com/check" }
    },
    updateCheck: async (request) => {
      updates.push(request)
      return { id: request.checkId, htmlUrl: "https://github.com/check" }
    },
  })
  await reporter.report({ type: "workflow.plan", plan, workflowId: "context", timestamp: "now" })
  await reporter.report({ type: "workflow.plan", plan, workflowId: "context", timestamp: "now" })
  assert.equal(creates.length, 2)
  assert.equal(updates.length, 2)
  for (const [index, request] of creates.entries()) {
    assert.equal(request.detailsUrl, detailsUrl)
    assert.match(request.text!, /```mermaid/)
    assert.match(request.text!, /step0 --> step1/)
    assert.match(request.text!, new RegExp(`class step${index} current`))
  }
  for (const request of updates) {
    assert.equal(request.detailsUrl, detailsUrl)
    assert.match(request.text!, /classDef current/)
  }
})
