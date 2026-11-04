import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("remote dispatch, capabilities, logs and status automatically use refreshed workload identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "workload-remote-"))
  let origin = "", identities = 0, dispatches = 0
  let rejectRuns = false
  const paths: string[] = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, origin)
    paths.push(url.pathname)
    if (url.pathname === "/github-identity") {
      assert.equal(url.searchParams.get("audience"), origin)
      assert.equal(request.headers.authorization, "Bearer github-request-token")
      response.end(JSON.stringify({ value: `job-identity-${++identities}` }))
      return
    }
    assert.match(request.headers.authorization!, /^Bearer job-identity-\d+$/)
    assert.equal(request.headers["cf-access-token"], undefined)
    if (url.pathname === "/api/oidc/repositories") {
      response.end(JSON.stringify({ issuer: origin, repository: "owner/project", enabled: true }))
    } else if (url.pathname === "/api/capabilities") {
      response.end(JSON.stringify({ protocol: "effect-ci-remote-v1", targets: [], targetDiscovery: "project", authentication: ["github-oidc"] }))
    } else if (url.pathname === "/api/runs") {
      dispatches++
      if (rejectRuns) {
        response.writeHead(503)
        response.end("Host unavailable")
        return
      }
      let body = ""
      for await (const chunk of request) body += chunk
      assert.equal(JSON.parse(body).repository, "https://github.com/owner/project.git")
      response.writeHead(202, { "content-type": "application/json" })
      response.end(JSON.stringify({ instanceId: "job-run", resultAvailable: true, eventsUrl: `${origin}/api/runs/job-run/events`, statusUrl: `${origin}/api/runs/job-run` }))
    } else if (url.pathname === "/api/runs/job-run/events") {
      response.end(JSON.stringify({ type: "workflow_completed", eventId: 1 }) + "\n")
    } else {
      assert.equal(url.pathname, "/api/runs/job-run")
      response.end(JSON.stringify({ status: "complete", output: { verified: true } }))
    }
  })
  try {
    for (const args of [["init", "-q"], ["config", "user.name", "OIDC proof"], ["config", "user.email", "oidc@example.invalid"], ["remote", "add", "origin", "https://github.com/owner/project.git"]]) execFileSync("git", args, { cwd: directory })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    origin = `http://127.0.0.1:${address.port}`
    mkdirSync(join(directory, ".cloudflare/ci"), { recursive: true })
    writeFileSync(join(directory, ".cloudflare/ci/oidc.json"), JSON.stringify({ issuer: origin, repository: "owner/project" }))
    execFileSync("git", ["add", "."], { cwd: directory })
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: directory })
    const env: NodeJS.ProcessEnv = { ...process.env, EFFECT_CI_REMOTE_TOKEN: "legacy-must-not-leak", CF_ACCESS_TOKEN: "access-must-not-leak", ACTIONS_ID_TOKEN_REQUEST_URL: origin + "/github-identity", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-token" }
    delete env.EFFECT_CI_OIDC_TOKEN
    delete env.EFFECT_CI_REMOTE_URL
    const run = (args: string[]) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const [command] = args
      const child = spawn(process.execPath, [fileURLToPath(new URL("./effect-ci.ts", import.meta.url)), ...args, ...(command === "oidc" ? [] : ["--format=json"])], { cwd: directory, env })
      let output = ""
      child.stdout.on("data", chunk => { output += chunk })
      child.stderr.on("data", chunk => { output += chunk })
      child.on("error", reject)
      child.on("exit", code => resolve({ code, output }))
    })
    const enabled = await run(["oidc", "--service", origin])
    assert.equal(enabled.code, 0, enabled.output)
    assert.ok(paths.includes("/api/oidc/repositories"))
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: directory, encoding: "utf8" }), "")
    const doctor = await run(["doctor", "--remote"])
    assert.equal(doctor.code, 0, doctor.output)
    assert.equal(dispatches, 0)
    const result = await run(["run", "build"])
    assert.equal(result.code, 0, result.output)
    assert.equal(dispatches, 1)
    assert.ok(paths.includes("/api/runs/job-run/events"))
    assert.ok(paths.includes("/api/runs/job-run"))
    assert.ok(identities >= 5)
    assert.doesNotMatch(result.output, /job-identity|must-not-leak|github-request-token/)
    const explicit = await run(["run", "build", "--remote"])
    assert.equal(explicit.code, 0, explicit.output)
    assert.equal(dispatches, 2)
    rejectRuns = true
    const failed = await run(["run", "build"])
    assert.equal(failed.code, 3, failed.output)
    assert.equal(JSON.parse(failed.output).error.code, "CI_REMOTE_FAILED")
    assert.equal(existsSync(join(directory, ".cloudflare/ci/ci.ts")), false)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
