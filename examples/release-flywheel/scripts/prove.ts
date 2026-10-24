import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createPrivateKey, sign } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { hostedCheckBytes } from "../../../packages/cloudflare/src/check-evidence.ts"
import { identifyFlywheel, command, repository, fixtureRoot, buildBytes, digest } from "../../../apps/example-runner/src/flywheel-identity.ts"
import trust from "../../../apps/example-runner/src/flywheel-trust.ts"
import workflow from "../.cloudflare/ci/workflow.ts"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const fixture = resolve(root, fixtureRoot)
const output = resolve(root, ".effect-ci/cache/release-flywheel")
mkdirSync(output, { recursive: true })
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
const revision = process.env.FLYWHEEL_REVISION ?? git("rev-parse", "HEAD")
assert.match(revision, /^[a-f0-9]{40}$/)
const key = () => createPrivateKey(readFileSync(resolve(root, ".effect-ci/cache/flywheel-private.pem")))
const serializeSignature = (bytes: Uint8Array) => sign(null, bytes, key()).toString("base64url")
const event: CI.WorkflowEventShape = { type: "workflow_dispatch", revision, source: { kind: "git", repository, revision } }
const save = (name: string, value: unknown) => writeFileSync(resolve(output, `${name}.json`), JSON.stringify(value, null, 2) + "\n")
const read = (name: string) => JSON.parse(readFileSync(resolve(output, `${name}.json`), "utf8"))
const cf = (...args: string[]) => JSON.parse(execFileSync(process.execPath,
  [resolve(root, "apps/effect-ci/node_modules/cf/bin/cf"), ...args], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }))

switch (process.argv[2]) {
  case "local": {
    for (const file of ["worker.mjs", "worker.test.mjs"]) assert.equal(readFileSync(resolve(fixture, file), "utf8"),
      execFileSync("git", ["show", `${revision}:${fixtureRoot}/${file}`], { cwd: root, encoding: "utf8" }), "Check the committed fixture bytes")
    const startedAt = Date.now()
    const executions: Array<{ step: string; elapsedMs: number }> = []
    let envelope: string | undefined
    const result = await CI.runPromise(workflow, {
      event, output: "silent", source: { reference: event.source!, checkout: () => Effect.succeed(CI.Workspace.local(fixture)) },
      executor: { execute: request => Effect.sync(() => {
        const start = Date.now()
        let stdout = ""
        if (request.command === command) stdout = execFileSync(process.execPath, ["--test", "worker.test.mjs"], { cwd: fixture, env: {}, encoding: "utf8" })
        else if (request.command === "cp worker.mjs candidate.mjs") copyFileSync(resolve(fixture, "worker.mjs"), resolve(fixture, "candidate.mjs"))
        else throw new Error("Unreviewed demo command")
        executions.push({ step: request.stepId, elapsedMs: Date.now() - start })
        return { exitCode: 0, stdout, stderr: "" }
      }) },
      checkCache: { lookup: () => Effect.succeed(false), record: request => Effect.promise(async () => {
        const identity = await identifyFlywheel(request, async path => readFileSync(resolve(fixture, path), "utf8"),
          async () => JSON.stringify({ node: process.versions.node, v8: process.versions.v8 }), trust.sourceDigest)
        assert.ok(identity, "Fixture or runtime is outside the enrolled demo policy")
        envelope = JSON.stringify({ version: 1, keyId: trust.keyId, identity, signature: serializeSignature(hostedCheckBytes(identity)) })
      }) },
    })
    assert.ok(envelope)
    const noteFile = resolve(output, "note.json")
    writeFileSync(noteFile, envelope + "\n")
    // Preserve existing evidence instead of silently overwriting an attestation.
    const existing = execFileSync("git", ["notes", "--ref=effect-ci-hosted-checks-v1", "list"], { cwd: root, encoding: "utf8" })
    if (existing.split("\n").some(line => line.endsWith(` ${revision}`)))
      assert.equal(git("notes", "--ref=effect-ci-hosted-checks-v1", "show", revision), envelope)
    else git("notes", "--ref=effect-ci-hosted-checks-v1", "add", "-F", noteFile, revision)
    const proof = { revision, startedAt, finishedAt: Date.now(), executions,
      nodes: result.plan.nodes.map(n => ({ id: n.id, status: n.status })),
      toolchain: { node: process.versions.node, v8: process.versions.v8 } }
    save("local", proof); console.log(JSON.stringify(proof, null, 2)); break
  }
  case "upload": {
    assert.equal(read("local").revision, revision)
    const module = readFileSync(resolve(fixture, "candidate.mjs"), "utf8")
    assert.equal(module, readFileSync(resolve(fixture, "worker.mjs"), "utf8"))
    assert.equal(module, execFileSync("git", ["show", `${revision}:${fixtureRoot}/worker.mjs`], { cwd: root, encoding: "utf8" }))
    const who = cf("auth", "whoami")
    assert.equal(who.accounts.length, 1, "Choose an account explicitly for a different installation")
    const account = who.accounts[0].id
    const token = JSON.parse(readFileSync(resolve(homedir(), "Library/Preferences/cloudflare/config/default.json"), "utf8")).oauth_token
    assert.equal(typeof token, "string")
    const form = new FormData()
    const moduleDigest = await digest(module)
    form.set("metadata", new Blob([JSON.stringify({ main_module: "candidate.mjs", compatibility_date: "2026-10-07",
      bindings: [{ type: "version_metadata", name: "WORKER_METADATA" }],
      annotations: { "workers/commit_sha": revision, "workers/message": `release-flywheel module-sha256:${moduleDigest}` },
    })], { type: "application/json" }))
    form.set("candidate.mjs", new Blob([module], { type: "application/javascript+module" }), "candidate.mjs")
    const startedAt = Date.now()
    // Upload Version creates an inactive version. No deployment API is called here.
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/effect-ci-hmd-demo/versions`, {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: form, redirect: "error", signal: AbortSignal.timeout(60_000),
    })
    const value = await response.json() as any
    assert.ok(response.ok && value.success, `Version upload failed (${response.status}): ${JSON.stringify(value.errors)}`)
    assert.match(value.result.id, /^[0-9a-f-]{36}$/)
    const receipt = { version: value.result.id as string, revision, moduleDigest }
    save("build", { ...receipt, signature: serializeSignature(buildBytes(receipt)) })
    save("upload", { ...receipt, startedAt, finishedAt: Date.now(), deployed: false })
    console.log(JSON.stringify({ ...receipt, deployed: false }, null, 2)); break
  }
  case "verify": case "release": {
    const mode = process.argv[2]
    const body = { params: { revision, mode, ...(mode === "release" ? { build: read("build") } : {}) } }
    const startedAt = Date.now()
    const run = cf("workflows", "instances", "create", "effect-ci-release-flywheel", "--body", JSON.stringify(body))
    save(mode, { revision, startedAt, run }); console.log(JSON.stringify(run, null, 2)); break
  }
  case "read": {
    const id = process.argv[3]
    assert.ok(id)
    const run = cf("workflows", "instances", "get", id, "--workflow-name", "effect-ci-release-flywheel")
    save(`run-${id}`, run)
    console.log(JSON.stringify({ id, status: run.status, output: run.output,
      lastSteps: run.steps?.slice(-5).map((s: any) => ({ name: s.name, success: s.success, error: s.error })) }, null, 2)); break
  }
  default: throw new Error("Use local, upload, verify, release, or read INSTANCE. Approval is a separate human decision.")
}
