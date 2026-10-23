import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { encodeCommandDiagnostics } from "../../ci/src/command-diagnostics.ts"

test("remote CLI authenticates dispatch and tails logs; dirty input cannot silently become HEAD", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-ci-remote-"))
  const workstationHome = await mkdtemp(join(tmpdir(), "effect-ci-private-home-"))
  const ci = fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url))
  const bin = fileURLToPath(new URL("./bin.ts", import.meta.url))
  const server = createServer()
  let dispatches = 0
  let disconnectOnce = false
  let resumed = 0
  let failWorkflow = false
  let diagnosticFailure = false
  let routePrefix = ""
  let supportsTargets = true
  let capabilityStatus = 200
  let capabilityProtocol = "effect-ci-remote-v1"
  let resultAvailable = false
  let resultStatus = 200
  let resultReads = 0
  let targetDiscovery: unknown
  const selections: unknown[] = []
  try {
    await writeFile(join(directory, "ci.ts"), `import * as CI from ${JSON.stringify(ci)}; export default CI.workflow("remote-fixture", function* () {});\n`)
    for (const args of [
      ["init", "-q"], ["config", "user.name", "CI fixture"],
      ["config", "user.email", "ci@example.invalid"],
      ["add", "ci.ts"], ["commit", "-qm", "fixture"],
      ["remote", "add", "origin", "https://github.com/example/project.git"],
    ]) execFileSync("git", args, { cwd: directory })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    const origin = `http://127.0.0.1:${address.port}`
    server.on("request", async (request, response) => {
      if (!request.headers.authorization) {
        response.writeHead(401); response.end("API authentication required"); return
      }
      assert.equal(request.headers.authorization, "Bearer fixture-api-token")
      if (request.headers["cf-access-token"]) {
        assert.equal(request.headers["cf-access-token"], "fixture-user-token")
        assert.equal(request.headers["cf-access-client-id"], undefined)
        assert.equal(request.headers["cf-access-client-secret"], undefined)
      } else {
        assert.equal(request.headers["cf-access-client-id"], "fixture-access-id")
        assert.equal(request.headers["cf-access-client-secret"], "fixture-access-secret")
      }
      if (request.url === `${routePrefix}/capabilities`) {
        response.writeHead(supportsTargets ? capabilityStatus : 404, { "content-type": "application/json",
          ...([302,307].includes(capabilityStatus) ? {location:"https://fixture.cloudflareaccess.com/cdn-cgi/access/login?token=never-reflect-login-token"} : {}) })
        response.end(JSON.stringify({ protocol: capabilityProtocol, targets: targetDiscovery === "project" ? [] : ["test", "build"],
          ...(targetDiscovery === undefined ? {} : { targetDiscovery }) }))
        return
      }
      if (request.url === `${routePrefix}/runs/fixture` && resultAvailable) {
        resultReads++
        response.writeHead(resultStatus, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "complete", output: { evidence: { receipts: [{ keyId: "host-fixture", signature: "test-only" }] } } }))
        return
      }
      if (request.url === `${routePrefix}/runs`) {
        dispatches++
        let body = ""
        for await (const chunk of request) body += chunk
        assert.match(JSON.parse(body).revision, /^[a-f0-9]{40}$/)
        selections.push(JSON.parse(body).targets)
        response.writeHead(202, { "content-type": "application/json" })
        response.end(JSON.stringify({ instanceId: "fixture", eventsUrl: `${origin}${routePrefix}/runs/fixture/events`, statusUrl: `${origin}${routePrefix}/runs/fixture`,
          ...(resultAvailable ? { resultAvailable: true } : {}) }))
      } else {
        response.writeHead(200, { "content-type": "application/x-ndjson" })
        if (request.url === `${routePrefix}/runs/fixture/events?cursor=1`) {
          resumed++
          response.write(JSON.stringify({ eventId: 1, type: "step_completed", stepName: "lint", output: JSON.stringify({ stdout: "lint passed" }) }) + "\n")
          response.write(JSON.stringify({ eventId: 2, type: "workflow_completed" }) + "\n")
          return
        }
        if (failWorkflow) {
          response.write(JSON.stringify({ eventId: 1, type: "workflow_errored", error: { message: "fixture failure" } }) + "\n")
          return
        }
        if (diagnosticFailure) {
          const message = encodeCommandDiagnostics({ version: 1, stepId: "compile", command: "node check.mjs", cwd: "/workspace", exitCode: 7,
            output: { stdout: "compiler context\n", stderr: "missing export\n", truncated: false } })!
          response.write(JSON.stringify({ eventId: 1, type: "step_errored", stepName: 'action:"compile"', error: { message } }) + "\n")
          response.write(JSON.stringify({ eventId: 2, type: "workflow_errored", error: { message } }) + "\n")
          return
        }
        response.write(JSON.stringify({ eventId: 1, type: "step_completed", stepName: "lint", output: JSON.stringify({ stdout: "lint passed" }) }) + "\n")
        if (disconnectOnce) {
          disconnectOnce = false
          setTimeout(() => response.destroy(), 50)
          return
        }
        response.write(JSON.stringify({ eventId: 2, type: "workflow_completed" }) + "\n")
        // Native subscriptions may remain open after the terminal event.
      }
    })
    const run = (userToken = "", explicit = true, format = "text", projectConfig = false, targets: string[] = [], command = "run", fromFile = false) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, command, ...targets, "--remote", `--format=${format}`, ...(fromFile ? ["--env-file", ".env.production"] : []), ...(explicit ? ["--workflow", join(directory, "ci.ts")] : [])], {
        cwd: directory,
        env: { ...process.env, EFFECT_CI_REMOTE_PROFILE: join(workstationHome, ".config", "effect-ci", "remotes.json"), EFFECT_CI_REMOTE_URL: fromFile ? "http://unused.invalid" : projectConfig ? "" : origin + routePrefix, EFFECT_CI_REMOTE_TOKEN: fromFile ? "stale-token" : projectConfig ? "" : "fixture-api-token", CF_ACCESS_CLIENT_ID: "fixture-access-id", CF_ACCESS_CLIENT_SECRET: "fixture-access-secret", CF_ACCESS_TOKEN: userToken },
      })
      let output = ""
      child.stdout.on("data", (chunk) => { output += chunk })
      child.stderr.on("data", (chunk) => { output += chunk })
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, output }))
    })
    const ready = await run("fixture-user-token", false, "json", false, [], "doctor")
    assert.equal(ready.code, 0, ready.output)
    assert.deepEqual(JSON.parse(ready.output), { schemaVersion: 1, ok: true, command: "doctor", location: "remote", targets: ["test", "build"], dispatched: false })
    assert.doesNotMatch(ready.output, /fixture-api-token|fixture-user-token/)
    assert.equal(dispatches, 0)
    const success = await run()
    assert.equal(success.code, 0, success.output)
    assert.match(success.output, /lint passed/)
    assert.match(success.output, /Workflow completed/)
    const userSuccess = await run("fixture-user-token")
    assert.equal(userSuccess.code, 0, userSuccess.output)
    assert.match(userSuccess.output, /Workflow completed/)
    disconnectOnce = true
    const reconnected = await run("fixture-user-token")
    assert.equal(reconnected.code, 0, reconnected.output)
    assert.equal(resumed, 1)
    assert.equal(reconnected.output.split("lint passed").length - 1, 1)
    failWorkflow = true
    const failed = await run("fixture-user-token")
    assert.equal(failed.code, 1)
    assert.match(failed.output, /Workflow failed: fixture failure/)
    failWorkflow = false
    diagnosticFailure = true
    const agentFailure = await run("fixture-user-token", true, "json")
    assert.equal(agentFailure.code, 1, agentFailure.output)
    const envelope = JSON.parse(agentFailure.output)
    assert.equal(envelope.error.code, "CI_WORKFLOW_FAILED")
    assert.deepEqual(envelope.error.details.diagnostics, [{ stepId: "compile", command: "node check.mjs", cwd: "/workspace", exitCode: 7,
      output: { stdout: "compiler context\n", stderr: "missing export\n", truncated: false } }])
    assert.doesNotMatch(envelope.error.message, /effect-ci-command-error-v1/)
    diagnosticFailure = false
    // Removing the only workflow proves root dispatch does not import a local program.
    execFileSync("git", ["rm", "ci.ts"], { cwd: directory })
    execFileSync("git", ["commit", "-qm", "hosted-only checkout"], { cwd: directory })
    const hosted = await run("fixture-user-token", false)
    assert.equal(hosted.code, 0, hosted.output)
    assert.match(hosted.output, /Workflow completed/)
    routePrefix = "/demo"
    const mounted = await run("fixture-user-token", false)
    assert.equal(mounted.code, 0, mounted.output)
    assert.match(mounted.output, /Workflow completed/)
    // A fresh workstation needs no exported URL: exercise the real CLI's files.
    await writeFile(join(directory, ".gitignore"), ".env\n.env.local\n")
    execFileSync("git", ["add", ".gitignore"], { cwd: directory })
    execFileSync("git", ["commit", "-qm", "private workstation config"], { cwd: directory })
    await writeFile(join(directory, ".env"), `EFFECT_CI_REMOTE_URL=${origin}${routePrefix}\n`)
    const missingToken = await run("fixture-user-token", false, "json", true)
    assert.equal(missingToken.code, 3, missingToken.output)
    assert.equal(JSON.parse(missingToken.output).error.code, "CI_REMOTE_AUTH_REQUIRED")
    assert.equal(dispatches, 7, "Access alone must not dispatch or imply API authentication")
    const unready = await run("fixture-user-token", false, "json", true, [], "doctor")
    assert.equal(unready.code, 3, unready.output)
    assert.equal(JSON.parse(unready.output).error.code, "CI_REMOTE_AUTH_REQUIRED")
    assert.equal(dispatches, 7)
    const profileDirectory = join(workstationHome, ".config", "effect-ci")
    await mkdir(profileDirectory, { recursive: true, mode: 0o700 })
    await writeFile(join(profileDirectory, "remotes.json"), JSON.stringify({ version: 1, remotes: [{
      repository: "https://github.com/example/project.git", url: origin + routePrefix, token: "fixture-api-token",
    }] }), { mode: 0o600 })
    const configured = await run("fixture-user-token", false, "text", true)
    assert.equal(configured.code, 0, configured.output)
    assert.match(configured.output, /Workflow completed/)
    const selected = await run("fixture-user-token", false, "text", true, ["test", "build"])
    assert.equal(selected.code, 0, selected.output)
    assert.deepEqual(selections.at(-1), ["test", "build"])
    const single = await run("fixture-user-token", false, "text", true, ["build"])
    assert.equal(single.code, 0, single.output)
    assert.deepEqual(selections.at(-1), ["build"])
    for (const targets of [["test", "deploy"], ["test", "build"]]) {
      if (targets[1] === "build") supportsTargets = false
      const denied = await run("fixture-user-token", false, "json", true, targets)
      assert.equal(denied.code, 3, denied.output)
      assert.equal(JSON.parse(denied.output).error.code, "CI_REMOTE_TARGET_UNAVAILABLE")
      assert.equal(dispatches, 10, "unknown goals and older hosts must not dispatch the default suite")
    }
    supportsTargets = true
    for (const status of [401, 403, 302, 307]) {
      capabilityStatus = status
      const denied = await run("fixture-user-token", false, "json", true, ["test", "build"])
      assert.equal(denied.code, 3, denied.output)
      assert.equal(JSON.parse(denied.output).error.code, "CI_REMOTE_AUTH_REQUIRED")
      assert.doesNotMatch(denied.output, /never-reflect-login-token/)
      assert.equal(dispatches, 10, "capability authentication failure must not dispatch")
    }
    capabilityStatus = 200
    capabilityProtocol = "unknown-protocol"
    const incompatible = await run("fixture-user-token", false, "json", true, ["test", "build"])
    assert.equal(incompatible.code, 3, incompatible.output)
    assert.equal(JSON.parse(incompatible.output).error.code, "CI_REMOTE_TARGET_UNAVAILABLE")
    assert.equal(dispatches, 10, "an incompatible capability protocol must not dispatch")
    capabilityProtocol = "effect-ci-remote-v1"
    await writeFile(join(directory, "uncommitted.txt"), "must not be silently ignored")
    await mkdir(join(directory, ".cloudflare", "ci"), { recursive: true })
    await writeFile(join(directory, ".cloudflare", "ci", "workflow.ts"), 'throw Error("Doctor must never import project code");\n')
    const dirtyReady = await run("fixture-user-token", false, "text", true, [], "doctor")
    assert.equal(dirtyReady.code, 0, dirtyReady.output)
    assert.match(dirtyReady.output, /Remote access ready/)
    assert.equal(dispatches, 10)
    await rm(join(directory, ".cloudflare"), { recursive: true })
    const dirty = await run("fixture-user-token", false)
    assert.equal(dirty.code, 2, dirty.output)
    assert.match(dirty.output, /not local edits/)
    assert.equal(dispatches, 10)
    await rm(join(directory, "uncommitted.txt"))
    resultAvailable = true
    const signedResult = await run("fixture-user-token", false, "json", true)
    assert.equal(signedResult.code, 0, signedResult.output)
    assert.equal(JSON.parse(signedResult.output).result.output.evidence.receipts[0].keyId, "host-fixture")
    assert.equal(resultReads, 1)
    resultStatus = 503
    const missingResult = await run("fixture-user-token", false, "json", true)
    assert.equal(missingResult.code, 3, missingResult.output)
    assert.equal(JSON.parse(missingResult.output).error.code, "CI_REMOTE_RESULT_UNAVAILABLE")
    assert.match(JSON.parse(missingResult.output).error.message, /do not dispatch again/)
    assert.equal(dispatches, 12, "a missing receipt never redispatches completed work")
    resultAvailable = false
    targetDiscovery = "project"
    const projectGoals = await run("fixture-user-token", false, "json", true, ["notes", "package:build"])
    assert.equal(projectGoals.code, 0, projectGoals.output)
    assert.deepEqual(selections.at(-1), ["notes", "package:build"])
    assert.equal(dispatches, 13)
    const projectReady = await run("fixture-user-token", false, "json", true, [], "doctor")
    assert.equal(JSON.parse(projectReady.output).targetDiscovery, "project")
    for (const invalid of [true, "anything", {}, null]) {
      targetDiscovery = invalid
      const denied = await run("fixture-user-token", false, "json", true, ["notes"])
      assert.equal(denied.code, 3, denied.output)
      assert.equal(JSON.parse(denied.output).error.code, "CI_REMOTE_TARGET_UNAVAILABLE")
      assert.equal(dispatches, 13, "unknown discovery protocols never dispatch")
    }
    await writeFile(join(directory, ".git/info/exclude"), ".env.production\n")
    await writeFile(join(directory, ".env.production"), [
      `EFFECT_CI_PUBLIC_URL=${origin}${routePrefix}`,
      "EFFECT_CI_API_TOKEN=fixture-api-token",
      "CF_ACCESS_CLIENT_ID=fixture-access-id",
      "CF_ACCESS_CLIENT_SECRET=fixture-access-secret",
    ].join("\n"))
    targetDiscovery = "project"
    const fromFile = await run("stale-user-token", false, "text", false, [], "run", true)
    assert.equal(fromFile.code, 0, fromFile.output)
    assert.match(fromFile.output, /Workflow completed/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
    await rm(workstationHome, { recursive: true, force: true })
  }
})
