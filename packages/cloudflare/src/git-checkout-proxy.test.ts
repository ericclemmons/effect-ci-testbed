import assert from "node:assert/strict"
import test from "node:test"
import { authenticatedGitFailure, gitCheckoutRequest, githubCheckoutRepository } from "./git-checkout-proxy.ts"

const repository = "https://github.com/owner/private.git"
const token = "host-only-secret-canary"
const url = "http://github-checkout.ci/owner/private.git/info/refs?service=git-upload-pack"

test("safe Git failure categories never include reflected tokens or arbitrary output", () => {
  assert.equal(authenticatedGitFailure("clone", `fatal: ${token} requested URL returned error: 403`).message, "Authenticated git clone failed (HTTP 403)")
  assert.equal(authenticatedGitFailure("clone", `destination ${token} already exists and is not an empty directory`).message, "Authenticated git clone failed (destination is not empty)")
  assert.equal(authenticatedGitFailure("fetch", token).message, "Authenticated git fetch failed")
})

test("compressed Git upload-pack requests retain their encoding without forwarding arbitrary headers", async () => {
  const bytes = new Uint8Array([31, 139, 8, 0])
  const response = await gitCheckoutRequest(new Request("http://github-checkout.ci/owner/private.git/git-upload-pack", {
    method: "POST", headers: { "content-type": "application/x-git-upload-pack-request", "content-encoding": "gzip", cookie: token }, body: bytes,
  }), repository, token, async (incoming) => {
    assert.equal(incoming.headers.get("content-encoding"), "gzip")
    assert.equal(incoming.headers.get("cookie"), null)
    assert.deepEqual(new Uint8Array(await incoming.arrayBuffer()), bytes)
    return new Response("pack", { headers: { "content-type": "application/x-git-upload-pack-result" } })
  })
  assert.equal(response.status, 200)
})

test("GitHub smart HTTP authenticates only upstream and strips all response metadata", async () => {
  for (const method of ["GET", "POST"]) {
    const request = method === "GET" ? new Request(url) : new Request("http://github-checkout.ci/owner/private.git/git-upload-pack", { method, headers: { "content-type": "application/x-git-upload-pack-request", "git-protocol": "version=2", cookie: "untrusted" }, body: "0000" })
    const type = method === "GET" ? "application/x-git-upload-pack-advertisement" : "application/x-git-upload-pack-result"
    const result = await gitCheckoutRequest(request, repository, token, async (incoming) => {
      assert.equal(incoming.url, request.url.replace("http://github-checkout.ci", "https://github.com"))
      assert.equal(incoming.headers.get("authorization"), `Basic ${btoa(`x-access-token:${token}`)}`)
      assert.equal(incoming.headers.get("cookie"), null)
      assert.equal(incoming.redirect, "manual")
      if (method === "POST") assert.equal(await incoming.text(), "0000")
      return new Response("packet bytes", { headers: { "content-type": type, "set-cookie": token, "x-reflected-auth": token } })
    })
    assert.equal(await result.text(), "packet bytes")
    assert.equal(result.headers.get("set-cookie"), null)
    assert.equal(result.headers.get("x-reflected-auth"), null)
    assert.equal(result.headers.get("cache-control"), "no-store")
  }
})

test("GitHub credential proxy rejects other repositories, push, redirects and reflected errors", async () => {
  let calls = 0
  const upstream = async () => { calls++; return new Response(token, { status: 302, headers: { location: "https://attacker.invalid", "x-auth": token } }) }
  for (const request of [
    new Request(url.replace("owner/private", "other/private")),
    new Request(url.replace("github-checkout.ci", "attacker.invalid")),
    new Request(url + "&extra=1"),
    new Request(url, { headers: { authorization: "Bearer placeholder" } }),
    new Request(url.replace("git-upload-pack", "git-receive-pack")),
    new Request(url, { method: "DELETE" }),
  ]) assert.equal((await gitCheckoutRequest(request, repository, token, upstream)).status, 403)
  assert.equal(calls, 0)
  const redirected = await gitCheckoutRequest(new Request(url), repository, token, upstream)
  assert.equal(redirected.status, 502)
  assert.ok(!(await redirected.text()).includes(token))
  assert.equal(redirected.headers.get("location"), null)
  const failed = await gitCheckoutRequest(new Request(url), repository, token, async () => { throw new Error(token) })
  assert.ok(!(await failed.text()).includes(token))
  const reflected = await gitCheckoutRequest(new Request(url), repository, token, async () => new Response(token))
  assert.equal(reflected.status, 502)
  assert.ok(!(await reflected.text()).includes(token))
})

test("authenticated source URL cannot contain credentials, query, fragments or alternate hosts", () => {
  assert.equal(githubCheckoutRepository(repository), "owner/private.git")
  assert.equal(githubCheckoutRepository(repository.slice(0, -4)), "owner/private.git")
  for (const value of ["https://token@github.com/owner/private.git", repository + "?token=secret", repository + "#x", "http://github.com/owner/private.git", "https://evil.invalid/owner/private.git", "https://github.com/../private.git"]) assert.throws(() => githubCheckoutRepository(value))
})
