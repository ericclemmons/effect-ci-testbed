import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("Access-only CLI negotiates host enrollment before any default or selected dispatch; API profiles stay optional only for that mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-ci-access-only-")), server = createServer()
  let enrolled = true, allowed = true, dispatches = 0, capabilityReads = 0
  const bin = fileURLToPath(new URL("./bin.ts", import.meta.url))
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "access-fixture", scripts: { test: "node test.mjs", build: "node build.mjs" } }))
    for (const args of [["init", "-q"], ["config", "user.name", "CI fixture"], ["config", "user.email", "ci@example.invalid"],
      ["add", "package.json"], ["commit", "-qm", "Access fixture"], ["remote", "add", "origin", "https://github.com/example/project.git"]])
      execFileSync("git", args, { cwd: directory })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address(); assert.ok(address && typeof address !== "string")
    const origin = `http://127.0.0.1:${address.port}/demo`
    server.on("request", async (request, response) => {
      assert.equal(request.headers.authorization, undefined)
      assert.equal(request.headers["cf-access-token"], "fixture-owner-access")
      if (request.url === "/demo/capabilities") {
        capabilityReads++
        response.writeHead(allowed ? 200 : 401, { "content-type": "application/json" })
        response.end(JSON.stringify({ protocol: "effect-ci-remote-v1", targets: ["test", "build"],
          ...(enrolled ? { authentication: ["api-token", "cloudflare-access-identity"] } : {}) }))
      } else if (request.url === "/demo/runs") {
        dispatches++; let body = ""
        for await (const chunk of request) body += chunk
        assert.match(JSON.parse(body).revision, /^[a-f0-9]{40}$/)
        response.writeHead(202, { "content-type": "application/json" })
        response.end(JSON.stringify({ instanceId: "owned", eventsUrl: origin + "/runs/owned/events", statusUrl: origin + "/runs/owned" }))
      } else {
        assert.equal(request.url, "/demo/runs/owned/events")
        response.writeHead(200, { "content-type": "application/x-ndjson" })
        response.end(JSON.stringify({ eventId: 1, type: "workflow_completed" }) + "\n")
      }
    })
    const run = (args: string[], serviceOnly = false) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args, "--remote", "--format=json"], { cwd: directory,
        env: { ...process.env, EFFECT_CI_REMOTE_URL: origin, EFFECT_CI_REMOTE_TOKEN: "",
          EFFECT_CI_REMOTE_PROFILE: join(directory, "missing-profile.json"), CF_ACCESS_TOKEN: serviceOnly ? "" : "fixture-owner-access",
          CF_ACCESS_CLIENT_ID: "fixture-service-id", CF_ACCESS_CLIENT_SECRET: "fixture-service-secret" } })
      let output = ""; child.stdout.on("data", b => { output += b }); child.stderr.on("data", b => { output += b })
      child.on("error", reject); child.on("close", code => resolve({ code, output }))
    })
    const doctor = await run(["doctor"])
    assert.equal(doctor.code, 0, doctor.output); assert.equal(dispatches, 0)
    for (const args of [["run"], ["run", "test", "build"]]) {
      const result = await run(args); assert.equal(result.code, 0, result.output)
      assert.doesNotMatch(result.output, /fixture-owner-access|fixture-service-secret/)
    }
    assert.equal(dispatches, 2); assert.equal(capabilityReads, 3)
    enrolled = false
    for (const args of [["doctor"], ["run"], ["run", "test"]]) {
      const result = await run(args); assert.equal(result.code, 3, result.output)
      assert.equal(JSON.parse(result.output).error.code, "CI_REMOTE_AUTH_REQUIRED")
    }
    assert.equal(dispatches, 2, "older hosts cannot silently fall back to default execution")
    enrolled = true; allowed = false
    const denied = await run(["run", "test"])
    assert.equal(denied.code, 3); assert.equal(dispatches, 2)
    const before = capabilityReads, service = await run(["doctor"], true)
    assert.equal(service.code, 3, service.output); assert.equal(capabilityReads, before)
    assert.doesNotMatch(service.output, /fixture-service-secret|fixture-owner-access/)
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
