import assert from "node:assert/strict"
import test from "node:test"
import { hostedIdentity } from "./oidc-identity.ts"
import { operatorRemote, workloadRemote, type RunIdentityRegistry } from "./remote-identity.ts"
import type { OidcEnvironment } from "./oidc-repositories.ts"

const env: OidcEnvironment = { GITHUB_APP_ID: "1", GITHUB_PRIVATE_KEY: "unused", EFFECT_CI_PUBLIC_URL: "https://ci.example.com", EFFECT_CI_OIDC_OWNER_IDS: "456", RECEIPT_SIGNING_KEY: "s".repeat(64) }
const source = { repository_id: "123", repository_owner_id: "456", ref: "refs/heads/main", revision: "a".repeat(40) }
const records = () => {
  const runs = new Set<string>()
  const registry: RunIdentityRegistry = { get: async id => ["123", "789"].includes(id) ? { repository: id === "123" ? "owner/project" : "owner/other", repositoryId: id, ownerId: "456" } : undefined,
    enable: async () => {}, recordRun: async (repo, id) => { runs.add(repo + "/" + id) }, ownsRun: async (repo, id) => runs.has(repo + "/" + id) }
  return registry
}
const request = (path: string, token: string, body?: unknown) => new Request("https://ci.example.com" + path, {
  method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
})
const dispatch = { repository: "https://github.com/owner/project.git", revision: source.revision, ref: source.ref }

test("a verified operator Access session authorizes remote calls without a stored API token", async () => {
  let forwards = 0
  const response = await operatorRemote(new Request("https://ci.example.com/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(dispatch) }), env, async (req, auth) => {
    forwards++
    assert.ok(auth.EFFECT_CI_API_TOKEN)
    assert.equal(req.headers.get("authorization"), `Bearer ${auth.EFFECT_CI_API_TOKEN}`)
    return Response.json({ instanceId: "operator-run" }, { status: 202 })
  }, async () => true)
  assert.equal(response.status, 202)
  assert.equal(forwards, 1)
  for (const [headers, valid] of [[{}, false], [{ origin: "https://evil.example" }, true], [{ "sec-fetch-site": "cross-site" }, true]] as const) {
    assert.equal((await operatorRemote(new Request("https://ci.example.com/runs", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" }), env,
      async () => { throw new Error("Must not dispatch") }, async () => valid)).status, 401)
  }
})

test("workload identities bind dispatch to source and status/logs to repository run ownership", async () => {
  const registry = records()
  const token = await hostedIdentity(source, env.EFFECT_CI_PUBLIC_URL!, env.RECEIPT_SIGNING_KEY!)
  let forwarded = 0
  const forward = async (req: Request, auth: OidcEnvironment) => {
    forwarded++
    assert.notEqual(auth.EFFECT_CI_API_TOKEN, token)
    assert.equal(req.headers.get("authorization"), `Bearer ${auth.EFFECT_CI_API_TOKEN}`)
    assert.ok(!new URL(req.url).pathname.startsWith("/api"))
    return req.method === "POST" ? Response.json({ instanceId: "run-1", eventsUrl: "https://ci.example.com/runs/run-1/events", statusUrl: "https://ci.example.com/runs/run-1" }, { status: 202 }) : Response.json({ status: "complete" })
  }
  const response = await workloadRemote(request("/api/runs", token, dispatch), env, registry, forward)
  assert.equal(response.status, 202)
  assert.deepEqual(await response.json(), { instanceId: "run-1", eventsUrl: "https://ci.example.com/api/runs/run-1/events", statusUrl: "https://ci.example.com/api/runs/run-1" })
  for (const path of ["/api/runs/run-1", "/api/runs/run-1/events", "/api/capabilities"]) assert.equal((await workloadRemote(request(path, token), env, registry, forward)).status, 200)
  for (const body of [{ ...dispatch, repository: "https://github.com/owner/other" }, { ...dispatch, revision: "b".repeat(40) }, { ...dispatch, ref: "refs/heads/other" }]) {
    assert.equal((await workloadRemote(request("/api/runs", token, body), env, registry, forward)).status, 403)
  }
  const other = await hostedIdentity({ ...source, repository_id: "789" }, env.EFFECT_CI_PUBLIC_URL!, env.RECEIPT_SIGNING_KEY!)
  assert.equal((await workloadRemote(request("/api/runs/run-1/events", other), env, registry, forward)).status, 403)
  assert.equal((await workloadRemote(request("/api/runs/unknown", token), env, registry, forward)).status, 403)
  assert.equal((await workloadRemote(request("/api/runs/run-1/approvals/approve", token), env, registry, forward)).status, 404)
  assert.equal((await workloadRemote(request("/api/runs", "forged", dispatch), env, registry, forward)).status, 401)
  const outsider = await hostedIdentity({ ...source, repository_owner_id: "999" }, env.EFFECT_CI_PUBLIC_URL!, env.RECEIPT_SIGNING_KEY!)
  assert.equal((await workloadRemote(request("/api/runs", outsider, dispatch), env, registry, forward)).status, 403)
  assert.equal(forwarded, 4)
})
