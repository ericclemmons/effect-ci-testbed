import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { realpath } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose"
import { hostedIdentity } from "./oidc-identity.ts"

test("hosted app enrolls a repo, then exchanges GitHub and hosted identities with scoped issuance and revocation", { timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url)
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const pair = await generateKeyPair("RS256", { extractable: true })
  const jwk = { ...await exportJWK(pair.publicKey), kid: "github-key", alg: "RS256" }
  const secret = "s".repeat(64)
  const accountId = "a".repeat(32)
  const policy = { effect: "allow", permission_groups: [{ id: "workers-scripts-write" }], resources: { [`com.cloudflare.api.account.${accountId}`]: "*" } }
  const compiled = await build({ stdin: { contents: `import {enrollWorkload,workloadRemote} from ${JSON.stringify(fileURLToPath(new URL("./remote-identity.ts", import.meta.url)))}; import {oidc,repositoryRegistry,TokenLease,OidcRepositories} from ${JSON.stringify(fileURLToPath(new URL("./oidc.ts", import.meta.url)))}; export {TokenLease,OidcRepositories}; export default {fetch:(request,env,ctx)=>{ const path=new URL(request.url).pathname; const registry=repositoryRegistry(ctx); if(path==="/api/oidc/repositories")return enrollWorkload(request,env,registry); if(path.startsWith("/api/"))return workloadRemote(request,env,registry,async(req)=>req.method==="POST"?Response.json({instanceId:"runtime-run",eventsUrl:"https://ci.example.com/runs/runtime-run/events",statusUrl:"https://ci.example.com/runs/runtime-run"},{status:202}):Response.json({status:"complete"}));return oidc(request,env,ctx)}};`, resolveDir: fileURLToPath(new URL(".", import.meta.url)) }, bundle: true, write: false, format: "esm", platform: "neutral", external: ["cloudflare:workers"] })
  const issued: any[] = []
  let revoked = 0
  const runtime = new Miniflare({ workers: [{ config: {
    name: "hosted-oidc-test", compatibilityDate: "2026-10-07",
    env: Object.fromEntries(Object.entries({ EFFECT_CI_PUBLIC_URL: "https://ci.example.com", EFFECT_CI_API_TOKEN: "operator-token",
      EFFECT_CI_ACCESS_ISSUER: "https://team.cloudflareaccess.com", EFFECT_CI_ACCESS_AUD: "service-aud",
      EFFECT_CI_OIDC_OWNER_IDS: "456", EFFECT_CI_OIDC_SCOPES: JSON.stringify({ "workers:edit": [policy] }),
      CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_TOKEN_ISSUER: "issuer-secret", RECEIPT_SIGNING_KEY: secret,
      GITHUB_APP_ID: "1", GITHUB_PRIVATE_KEY: await exportPKCS8(pair.privateKey),
    }).map(([key, value]) => [key, { type: "text", value }])),
    exports: { TokenLease: { type: "durable-object", storage: "sqlite" }, OidcRepositories: { type: "durable-object", storage: "sqlite" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: compiled.outputFiles[0].text } } },
  }, dev: { outboundService: { type: "fetcher", handler: async (request: Request) => {
    if (request.url.endsWith("/.well-known/jwks") || request.url.endsWith("/cdn-cgi/access/certs")) return Response.json({ keys: [jwk] })
    if (request.url.endsWith("/installation")) return Response.json({ id: 1 })
    if (request.url.endsWith("/access_tokens")) return Response.json({ token: "installation-token" })
    if (request.url === "https://api.github.com/repos/owner/other") return Response.json({ id: 789, full_name: "owner/other", owner: { id: 456 } })
    if (request.url === "https://api.github.com/repos/owner/new-project") return Response.json({ id: 123, full_name: "owner/new-project", owner: { id: 456 } })
    assert.ok(request.url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens`))
    assert.equal(request.headers.get("authorization"), "Bearer issuer-secret")
    if (request.method === "DELETE") { revoked++; return Response.json({ success: true, result: {} }) }
    issued.push(await request.json())
    return Response.json({ success: true, result: { id: "b".repeat(32), value: "temporary-token" } })
  } } } }] })
  const post = (path: string, token: string, body?: unknown) => runtime.dispatchFetch(`https://ci.example.com${path}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const claims = { repository_id: "123", repository_owner_id: "456", ref: "refs/heads/new-feature", workflow_ref: "owner/new-project/.github/workflows/custom.yml@refs/heads/new-feature", run_id: "1", run_attempt: "1", event_name: "push", sha: "f".repeat(40) }
  const githubToken = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "github-key" }).setIssuer("https://token.actions.githubusercontent.com").setAudience("https://ci.example.com").setSubject("repo:owner/new-project").setJti("github-jti").setIssuedAt().setNotBefore("0s").setExpirationTime("5m").sign(pair.privateKey)
  const scope = { worker: "brand-new-worker", scopes: ["workers:edit"] }
  try {
    assert.equal((await post("/token", githubToken, scope)).status, 403)
    assert.equal(issued.length, 0)
    assert.equal((await post("/oidc/repositories", "bad-operator", { repository: "owner/new-project" })).status, 401)
    assert.equal((await post("/api/oidc/repositories", githubToken, { repository: "owner/other" })).status, 403)
    assert.equal((await post("/api/oidc/repositories", githubToken, { repository: "owner/new-project" })).status, 200)
    assert.equal((await post("/api/runs", githubToken, { repository: "https://github.com/owner/new-project.git", revision: claims.sha, ref: claims.ref })).status, 202)
    const read = await runtime.dispatchFetch("https://ci.example.com/api/runs/runtime-run/events", { headers: { authorization: `Bearer ${githubToken}` } })
    assert.equal(read.status, 200)
    assert.equal((await post("/api/runs", githubToken, { repository: "https://github.com/owner/other", revision: claims.sha })).status, 403)
    const accessToken = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "github-key" })
      .setIssuer("https://team.cloudflareaccess.com").setAudience("service-aud").setSubject("operator").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey)
    const accessEnroll = (token: string) => runtime.dispatchFetch("https://ci.example.com/oidc/repositories", { method: "POST",
      headers: { "cf-access-jwt-assertion": token, "content-type": "application/json" }, body: JSON.stringify({ repository: "owner/new-project" }) })
    assert.equal((await accessEnroll("forged")).status, 401)
    assert.equal((await accessEnroll(accessToken)).status, 200)
    assert.equal((await post("/oidc/repositories", "operator-token", { repository: "owner/new-project" })).status, 200)
    const hosted = await hostedIdentity({ repository_id: "123", repository_owner_id: "456", ref: claims.ref, revision: "f".repeat(40) }, "https://ci.example.com", secret)
    for (const token of [githubToken, hosted]) {
      assert.equal((await post("/token", token, { ...scope, scopes: ["admin"] })).status, 403)
      const response = await post("/token", token, scope)
      assert.equal(response.status, 200)
      const credential = await response.json() as { token: string; receipt: string }
      assert.equal(credential.token, "temporary-token")
      assert.equal((await post("/token", token, scope)).status, 403)
      assert.equal((await post("/revoke", credential.receipt)).status, 200)
    }
    const outsider = await hostedIdentity({ repository_id: "123", repository_owner_id: "999", ref: claims.ref, revision: "f".repeat(40) }, "https://ci.example.com", secret)
    assert.equal((await post("/token", outsider, scope)).status, 403)
    assert.equal(issued.length, 2)
    assert.equal(revoked, 2)
    assert.deepEqual(issued.map((value) => value.policies), [[policy], [policy]])
  } finally { await runtime.dispose() }
})
