import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { runOidc } from "./oidc.ts"

test("OIDC enrollment works without a workflow, saves no secrets, and deployment revokes on child failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "cf-ci-oidc-"))
  const previousFetch = globalThis.fetch
  const previous = { ...process.env }
  const previousExit = process.exitCode
  const calls: string[] = []
  try {
    execFileSync("git", ["init", "-q"], { cwd: root })
    execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/new-project.git"], { cwd: root })
    process.env.EFFECT_CI_REMOTE_URL = "https://ci.example.com"
    delete process.env.EFFECT_CI_OIDC_TOKEN
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      calls.push(url)
      const headers = new Headers(init?.headers)
      if (url.endsWith("/oidc/repositories")) {
        assert.equal(headers.get("authorization"), "Bearer operator-secret")
        assert.equal(headers.get("cf-access-token"), "access-secret")
        assert.deepEqual(JSON.parse(String(init?.body)), { repository: "owner/new-project" })
        return Response.json({ issuer: "https://ci.example.com", repository: "owner/new-project", enabled: true })
      }
      assert.equal(headers.has("cf-access-token"), false)
      if (url.endsWith("/token")) {
        assert.equal(headers.get("authorization"), "Bearer hosted-identity")
        assert.deepEqual(JSON.parse(String(init?.body)), { worker: "*", scopes: ["workers:edit"] })
        return Response.json({ token: "temporary-deploy-token", accountId: "a".repeat(32), receipt: "revoke-receipt" })
      }
      assert.equal(headers.get("authorization"), "Bearer revoke-receipt")
      return Response.json({ revoked: true })
    }
    await runOidc([], root, new Headers({ authorization: "Bearer operator-secret", "cf-access-token": "access-secret" }))
    const config = readFileSync(join(root, ".cloudflare/ci/oidc.json"), "utf8")
    assert.deepEqual(JSON.parse(config), { issuer: "https://ci.example.com", repository: "owner/new-project" })
    assert.doesNotMatch(config, /secret|token/)
    process.env.EFFECT_CI_OIDC_TOKEN = "hosted-identity"
    await runOidc(["--", process.execPath, "-e", "if(process.env.CLOUDFLARE_API_TOKEN !== 'temporary-deploy-token' || process.env.EFFECT_CI_OIDC_TOKEN) process.exit(99); process.exit(7)"], root, new Headers())
    assert.equal(process.exitCode, 7)
    assert.deepEqual(calls.map((url) => new URL(url).pathname), ["/oidc/repositories", "/token", "/revoke"])
  } finally {
    globalThis.fetch = previousFetch
    process.env = previous
    process.exitCode = previousExit
    rmSync(root, { recursive: true, force: true })
  }
})

test("OIDC command help works before git initialization", async () => {
  await runOidc(["--help"], tmpdir(), new Headers())
})

test("cf-ci oidc enrolls a workflow-free project using the normal env-file loader", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cf-ci-oidc-entry-"))
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/oidc/repositories")
    assert.equal(request.headers.authorization, "Bearer fixture-api-token")
    assert.equal(request.headers["cf-access-token"], "fixture-access-token")
    let body = ""
    for await (const chunk of request) body += chunk
    assert.deepEqual(JSON.parse(body), { repository: "owner/project" })
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ enabled: true, repository: "owner/project", issuer: origin }))
  })
  let origin = ""
  try {
    execFileSync("git", ["init", "-q"], { cwd: directory })
    execFileSync("git", ["remote", "add", "origin", "https://github.com/owner/project.git"], { cwd: directory })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    origin = `http://127.0.0.1:${address.port}`
    writeFileSync(join(directory, ".env.local"), `EFFECT_CI_PUBLIC_URL=${origin}\nEFFECT_CI_API_TOKEN=fixture-api-token\nCF_ACCESS_TOKEN=fixture-access-token\n`)
    const env = { ...process.env }
    for (const key of ["EFFECT_CI_REMOTE_URL", "EFFECT_CI_REMOTE_TOKEN", "EFFECT_CI_API_TOKEN", "CF_ACCESS_TOKEN"]) delete env[key]
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("./bin.ts", import.meta.url)), "oidc"], { cwd: directory, env })
      let output = ""
      child.stdout.on("data", (chunk) => { output += chunk })
      child.stderr.on("data", (chunk) => { output += chunk })
      child.on("error", reject)
      child.on("exit", (code) => resolve({ code, output }))
    })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /OIDC enabled for owner\/project/)
    assert.deepEqual(JSON.parse(readFileSync(join(directory, ".cloudflare/ci/oidc.json"), "utf8")), { issuer: origin, repository: "owner/project" })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
