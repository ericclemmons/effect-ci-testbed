import assert from "node:assert/strict"
import test from "node:test"
import { enableRepository, type OidcEnvironment, type RepositoryIdentity } from "./oidc-repositories.ts"

const environment: OidcEnvironment = { EFFECT_CI_API_TOKEN: "operator-token", EFFECT_CI_PUBLIC_URL: "https://ci.example.com",
  EFFECT_CI_OIDC_OWNER_IDS: "15182", EFFECT_CI_OIDC_SCOPES: "{}", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_TOKEN_ISSUER: "issuer-secret", RECEIPT_SIGNING_KEY: "s".repeat(32), GITHUB_APP_ID: "app", GITHUB_PRIVATE_KEY: "key" }
const request = (token = "operator-token", body: unknown = { repository: "owner/repo" }) => new Request("https://ci.example.com/oidc/repositories", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
})

test("operator enrollment stores GitHub-verified immutable identities, never client-supplied permissions", async () => {
  const records: RepositoryIdentity[] = []
  const identity = { repository: "owner/repo", repositoryId: "123", ownerId: "15182" }
  const registry = { get: async () => undefined, enable: async (record: RepositoryIdentity) => { records.push(record) } }
  const response = await enableRepository(request("operator-token", { repository: "owner/repo", repositoryId: "attacker", scopes: { admin: true } }),
    environment, registry, async () => identity)
  assert.equal(response.status, 200)
  assert.deepEqual(records, [identity])
  assert.deepEqual(await response.json(), { ...identity, issuer: environment.EFFECT_CI_PUBLIC_URL, enabled: true })
})

test("enrollment rejects missing API auth, bad input, unconfigured issuers, other owners and missing installations", async () => {
  let mutations = 0
  const registry = { get: async () => undefined, enable: async () => { mutations++ } }
  const identify = async () => ({ repository: "other/repo", repositoryId: "456", ownerId: "999" })
  assert.equal((await enableRepository(request(""), environment, registry, identify)).status, 401)
  const { EFFECT_CI_API_TOKEN, ...withoutToken } = environment
  const { RECEIPT_SIGNING_KEY, ...withoutIssuer } = environment
  assert.equal((await enableRepository(request(), withoutToken, registry, identify)).status, 401)
  assert.equal((await enableRepository(request(), withoutIssuer, registry, identify)).status, 503)
  for (const body of [null, { repository: "https://evil.example/repo" }, { repository: "owner/repo/path" }]) {
    assert.equal((await enableRepository(request("operator-token", body), environment, registry, identify)).status, 400)
  }
  assert.equal((await enableRepository(request(), environment, registry, identify)).status, 403)
  assert.equal((await enableRepository(request(), environment, registry, async () => { throw new Error("private upstream response") })).status, 502)
  assert.equal(mutations, 0)
})

test("repository enrollment for remote CI does not require Cloudflare deployment authority", async () => {
  const { CLOUDFLARE_TOKEN_ISSUER, CLOUDFLARE_ACCOUNT_ID, EFFECT_CI_OIDC_SCOPES, ...identityOnly } = environment
  let enabled = false
  const response = await enableRepository(request(), identityOnly, { get: async () => undefined, enable: async () => { enabled = true } },
    async () => ({ repository: "owner/repo", repositoryId: "123", ownerId: "15182" }))
  assert.equal(response.status, 200)
  assert.equal(enabled, true)
})
