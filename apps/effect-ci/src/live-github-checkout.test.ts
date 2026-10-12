import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

test("recorded native GitHub run completes both authenticated checkout paths without credential outputs", { skip: !process.env.LIVE_GITHUB_CHECKOUT_INSTANCE }, () => {
  const instance = process.env.LIVE_GITHUB_CHECKOUT_INSTANCE!
  const revision = process.env.LIVE_GITHUB_CHECKOUT_REVISION
  assert.match(revision ?? "", /^[0-9a-f]{40}$/)
  const run = JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", ["workflows", "instances", "get", instance, "--workflow-name", "effect-ci-github-cloudflare"], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
  assert.equal(run.status, "complete")
  assert.equal(run.params.trigger, "github")
  assert.equal(run.params.revision, revision)
  assert.ok(run.steps.some((step: any) => step.name === "workspace-cache:source-1" && step.success))
  assert.ok(run.steps.some((step: any) => step.name === "checkout-1" && step.success))
  assert.ok(run.output.nodes.every((node: any) => node.status === "complete"))
  assert.ok(!run.steps.some((step: any) => step.name.startsWith("notification:")))
  assert.ok(!/gh[spr]_[A-Za-z0-9]+|Authorization: Basic|x-access-token:/.test(JSON.stringify(run)), "credentials must not appear in native results")
  // This records the real proxy/clone/fetch/check-reporting path, not proof of
  // private authorization or a live forensic scan of the VM filesystem/processes.
})
