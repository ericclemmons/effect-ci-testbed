import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { encodeCommandDiagnostics } from "../../ci/src/command-diagnostics.ts"

test("remote CLI authenticates dispatch and tails logs; dirty input cannot silently become HEAD", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-ci-remote-"))
  const ci = fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url))
  const bin = fileURLToPath(new URL("./bin.ts", import.meta.url))
  const server = createServer()
  let dispatches = 0
  let disconnectOnce = false
  let resumed = 0
  let failWorkflow = false
  let diagnosticFailure = false
  let routePrefix = ""
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
      assert.equal(request.headers.authorization, "Bearer fixture-api-token")
      if (request.headers["cf-access-token"]) {
        assert.equal(request.headers["cf-access-token"], "fixture-user-token")
        assert.equal(request.headers["cf-access-client-id"], undefined)
        assert.equal(request.headers["cf-access-client-secret"], undefined)
      } else {
        assert.equal(request.headers["cf-access-client-id"], "fixture-access-id")
        assert.equal(request.headers["cf-access-client-secret"], "fixture-access-secret")
      }
      if (request.url === `${routePrefix}/runs`) {
        dispatches++
        let body = ""
        for await (const chunk of request) body += chunk
        assert.match(JSON.parse(body).revision, /^[a-f0-9]{40}$/)
        response.writeHead(202, { "content-type": "application/json" })
        response.end(JSON.stringify({ instanceId: "fixture", eventsUrl: `${origin}${routePrefix}/runs/fixture/events`, statusUrl: `${origin}${routePrefix}/runs/fixture` }))
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
    const run = (userToken = "", explicit = true, format = "text") => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, "run", "--remote", `--format=${format}`, ...(explicit ? ["--workflow", join(directory, "ci.ts")] : [])], {
        cwd: directory,
        env: { ...process.env, EFFECT_CI_REMOTE_URL: origin + routePrefix, EFFECT_CI_REMOTE_TOKEN: "fixture-api-token", CF_ACCESS_CLIENT_ID: "fixture-access-id", CF_ACCESS_CLIENT_SECRET: "fixture-access-secret", CF_ACCESS_TOKEN: userToken },
      })
      let output = ""
      child.stdout.on("data", (chunk) => { output += chunk })
      child.stderr.on("data", (chunk) => { output += chunk })
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, output }))
    })
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
    await writeFile(join(directory, "uncommitted.txt"), "must not be silently ignored")
    const dirty = await run("fixture-user-token", false)
    assert.equal(dirty.code, 2, dirty.output)
    assert.match(dirty.output, /not local edits/)
    assert.equal(dispatches, 7)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
