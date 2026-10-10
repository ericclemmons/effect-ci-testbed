import assert from "node:assert/strict"
import test from "node:test"
import { credentialRequest } from "../../../packages/cloudflare/src/credential-proxy.ts"

const request = () => new Request("http://credential.ci/verify", { headers: { authorization: "Bearer effect-ci-placeholder", "x-user-header": "untrusted" } })

test("only the host sees a credential and upstream reflection never reaches the workload", async () => {
  const response = await credentialRequest(request(), async () => "test-canary", async (incoming) => {
    assert.equal(incoming.url, "https://credential.internal/verify")
    assert.equal(incoming.redirect, "manual")
    assert.equal(incoming.headers.get("authorization"), "Bearer test-canary")
    assert.equal(incoming.headers.get("x-user-header"), null)
    return new Response("test-canary", { headers: { "x-leaked-token": "test-canary" } })
  })
  assert.deepEqual(await response.json(), { authenticated: true })
  assert.equal(response.headers.get("x-leaked-token"), null)
})

test("host, path, query, method and placeholder are checked before credential resolution", async () => {
  const headers = { authorization: "Bearer effect-ci-placeholder" }
  for (const incoming of [
    new Request("http://attacker.ci/verify", { headers }), new Request("http://credential.ci/other", { headers }),
    new Request("http://credential.ci/verify?target=attacker", { headers }),
    new Request("http://credential.ci/verify", { method: "POST", headers }),
    new Request("http://credential.ci/verify"),
  ]) {
    const response = await credentialRequest(incoming, async () => { assert.fail("credential resolved for denied request") }, async () => { assert.fail("upstream called") })
    assert.equal(response.status, 403)
  }
})

test("redirects and provider errors fail closed without reflecting secrets", async () => {
  for (const upstream of [
    async () => new Response("test-canary", { status: 302, headers: { location: "https://attacker.ci" } }),
    async () => { throw new Error("test-canary") },
  ]) {
    const response = await credentialRequest(request(), async () => "test-canary", upstream)
    assert.equal(response.status, 502)
    assert.equal(await response.text(), "Authentication failed")
  }
})
