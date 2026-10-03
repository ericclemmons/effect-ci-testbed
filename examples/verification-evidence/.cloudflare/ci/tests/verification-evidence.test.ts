import assert from "node:assert/strict"
import { generateKeyPairSync, sign, verify } from "node:crypto"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

import workflow from "../workflow.ts"

const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const proofs = new Map<string, Buffer>()

const fingerprint = (request: CI.VerificationRequest): string => JSON.stringify({
  command: request.command,
  revision: request.event.revision,
  scope: request.policy.scope,
  stepId: request.stepId,
  workflowId: request.workflowId,
  workspace: {
    cwd: request.workspace.cwd,
    id: request.workspace.id,
    revision: request.workspace.revision,
  },
})

const verification: CI.VerificationStore = {
  lookup: (request) => Effect.sync(() => {
    if (!request.event.revision) return false
    const message = fingerprint(request)
    const proof = proofs.get(message)

    return proof !== undefined && verify(null, Buffer.from(message), publicKey, proof)
  }),
  record: (request) => Effect.sync(() => {
    if (!request.event.revision) return
    const message = fingerprint(request)

    proofs.set(message, sign(null, Buffer.from(message), privateKey))
  }),
}

let executions = 0
const executor: CI.CommandExecutor = {
  execute: () => {
    executions++

    return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
  },
}

const run = (revision: string) => CI.runPromise(workflow, {
  event: { type: "push", ref: "refs/heads/main", revision },
  executor,
  output: "silent",
  verification,
})

await run("commit-a")
const reused = await run("commit-a")

assert.equal(executions, 1)
assert.equal(reused.plan.nodes.find((node) => node.id === "verified lint")?.status, "verified")

await run("commit-b")
assert.equal(executions, 2)
