import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import { Reporter } from "./reporter.ts"
import type { CreateCheckOptions, UpdateCheckOptions } from "./index.ts"

test("each step check shows the full graph, highlights itself, and links to its runner", async () => {
  const checkout = CI.action(
    "checkout",
    () =>
      function* () {
        return CI.Workspace.local("/tmp")
      },
  )
  const build = CI.action(
    "build",
    () =>
      function* () {
        return yield* checkout()
      },
  )
  const { plan } = await CI.runPromise(
    CI.workflow("context", () => build()),
    {
      mode: "plan",
      output: "silent",
    },
  )
  const creates: CreateCheckOptions[] = []
  const updates: UpdateCheckOptions[] = []
  const detailsUrl = "https://dash.cloudflare.com/account/workers/workflows/ci/instance/run"
  const reporter = new Reporter(
    { token: "test", repository: "owner/repo", sha: "sha", detailsUrl },
    {
      createCheck: async (request) => {
        creates.push(request)
        return { id: creates.length, htmlUrl: "https://github.com/check" }
      },
      updateCheck: async (request) => {
        updates.push(request)
        return { id: request.checkId, htmlUrl: "https://github.com/check" }
      },
    },
  )
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

test("final graphs show actual statuses and link every step to its own check", async () => {
  const checkout = CI.action(
    "checkout",
    () =>
      function* () {
        return CI.Workspace.local("/tmp")
      },
  )
  const build = CI.action(
    "build",
    () =>
      function* () {
        return yield* checkout()
      },
  )
  const { plan } = await CI.runPromise(
    CI.workflow("context", () => build()),
    { mode: "plan", output: "silent" },
  )
  const updates: UpdateCheckOptions[] = []
  let next = 100
  const reporter = new Reporter(
    { token: "fake", repository: "owner/repo", sha: "sha", executionEnvironment: "GitHub Actions" },
    {
      createCheck: async () => {
        const id = ++next
        return { id, htmlUrl: `https://github.com/owner/repo/runs/${id}` }
      },
      updateCheck: async (request) => {
        updates.push(request)
        return {
          id: request.checkId,
          htmlUrl: `https://github.com/owner/repo/runs/${request.checkId}`,
        }
      },
    },
  )
  await reporter.report({ type: "workflow.plan", plan, workflowId: "context", timestamp: "now" })
  await reporter.report({
    type: "step.status",
    stepId: "checkout",
    status: "complete",
    optional: false,
    workflowId: "context",
    timestamp: "now",
  })
  await reporter.report({
    type: "step.status",
    stepId: "build",
    status: "skipped",
    optional: false,
    workflowId: "context",
    timestamp: "now",
  })
  await reporter.report({
    type: "workflow.completed",
    conclusion: "failure",
    workflowId: "context",
    timestamp: "now",
  })
  for (const update of updates.slice(-2)) {
    assert.match(update.text!, /step0\["✅ checkout"\]/)
    assert.match(update.text!, /step1\["⊘ build"\]/)
    assert.match(update.text!, /click step0 href "https:\/\/github.com\/owner\/repo\/runs\/101"/)
    assert.match(update.text!, /\[✅ checkout\]\(<https:\/\/github.com\/owner\/repo\/runs\/101>\)/)
    assert.match(update.text!, /\[⊘ build\]\(<https:\/\/github.com\/owner\/repo\/runs\/102>\)/)
    assert.match(update.name!, /^GitHub Actions \/ context \/ [12]\. /)
  }
})

test("console logs cannot escape their fence and foreign check links are not rendered", async () => {
  const checkout = CI.action(
    "checkout",
    () =>
      function* () {
        return CI.Workspace.local("/tmp")
      },
  )
  const { plan } = await CI.runPromise(
    CI.workflow("logs", () => checkout()),
    { mode: "plan", output: "silent" },
  )
  const updates: UpdateCheckOptions[] = []
  const reporter = new Reporter(
    { token: "fake", repository: "owner/repo", sha: "sha" },
    {
      createCheck: async () => ({ id: 1, htmlUrl: "https://example.com/steal" }),
      updateCheck: async (request) => {
        updates.push(request)
        return { id: 1, htmlUrl: "https://example.com/steal" }
      },
    },
  )
  await reporter.report({ type: "workflow.plan", plan, workflowId: "logs", timestamp: "now" })
  await reporter.report({
    type: "step.output",
    stepId: "checkout",
    stream: "stdout",
    text: "$ npm test\n```\n### not a heading",
    workflowId: "logs",
    timestamp: "now",
  })
  await reporter.report({
    type: "step.status",
    stepId: "checkout",
    status: "complete",
    optional: false,
    workflowId: "logs",
    timestamp: "now",
  })
  assert.match(updates.at(-1)!.text!, /````console\n\$ npm test\n```\n### not a heading\n````/)
  assert.doesNotMatch(updates.at(-1)!.text!, /example.com|click step/)
})
