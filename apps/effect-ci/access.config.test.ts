import assert from "node:assert/strict"
import test from "node:test"
import { accessApplications } from "./access.config.ts"

test("Access protects the hostname and bypasses only explicitly enabled webhook paths", () => {
  const options = { hostname: "ci.example.com", reviewers: ["reviewer@example.com"] }
  const defaults = accessApplications(options)
  assert.equal(defaults.service.domain, options.hostname)
  assert.equal(defaults.service.policies[0]!.decision, "allow")
  assert.equal(defaults.webhook.domain, "ci.example.com/webhooks/github")
  assert.equal(defaults.slack, undefined)
  const enabled = accessApplications({ ...options, slackCallbacks: true })
  assert.equal(enabled.slack!.domain, "ci.example.com/webhooks/slack")
  assert.equal(enabled.slack!.policies[0]!.decision, "bypass")
  assert.deepEqual(enabled.service, defaults.service)
})

test("Access configuration fails closed without reviewers or a valid hostname", () => {
  assert.throws(() => accessApplications({ hostname: "ci.example.com", reviewers: [] }), /reviewer/)
  assert.throws(() => accessApplications({ hostname: "https://ci.example.com", reviewers: ["reviewer@example.com"] }), /hostname/)
})
