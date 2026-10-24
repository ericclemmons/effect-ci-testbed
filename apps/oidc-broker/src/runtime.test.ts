import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { issuer } from "./auth.ts";

for (const wildcard of [false, true]) test(`actual workerd verifies ${wildcard ? "owner wildcard" : "exact repository"} OIDC, issues once, preserves Worker scope, and revokes through the action client`, { timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const pair = await generateKeyPair("RS256");
  const publicKey = { ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256" };
  const accountId = "a".repeat(32);
  const policy = { effect: "allow", permission_groups: [{ id: "individual-workers-editor-fixture" }], resources: { account: { "one-worker-fixture": "*" } } };
  const grant = { repositoryId: wildcard ? "*" : "123", repositoryOwnerId: "456", ref: "refs/heads/main", workflowRef: `owner/${wildcard ? "*" : "repo"}/.github/workflows/deploy.yml@refs/heads/main`, accountId, worker: "one-worker", scopes: { "workers:edit": [policy] } };
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral", external: ["cloudflare:workers"],
  });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "oidc-broker-test", compatibilityDate: "2026-10-07",
    env: Object.fromEntries(Object.entries({ BROKER_AUDIENCE: "https://broker.example", BROKER_GRANTS: JSON.stringify([grant]), CLOUDFLARE_TOKEN_ISSUER: "test-issuer", RECEIPT_SIGNING_KEY: "r".repeat(64) }).map(([key, value]) => [key, { type: "text", value }])),
    exports: { TokenLease: { type: "durable-object", storage: "sqlite" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: compiled.outputFiles[0].text } } },
  }, dev: { outboundService: { type: "fetcher", handler: async (request: Request) => {
    if (request.url === `${issuer}/.well-known/jwks`) return Response.json({ keys: [publicKey] });
    assert.ok(request.url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens`));
    assert.equal(request.headers.get("authorization"), "Bearer test-issuer");
    calls.push({ url: request.url, method: request.method, body: request.method === "POST" ? await request.json() : null });
    return Response.json({ success: true, result: { id: "b".repeat(32), value: "temporary-secret" } });
  } } } }] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const identity = await new SignJWT({ repository_id: "123", repository_owner_id: "456", ref: grant.ref, workflow_ref: "owner/repo/.github/workflows/deploy.yml@refs/heads/main", run_id: "1", run_attempt: "1", event_name: "workflow_dispatch" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience("https://broker.example")
      .setSubject("repo:owner/repo:ref:refs/heads/main").setJti("test-issuance").setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 300).sign(pair.privateKey);
    const post = (path: string, token: string, body?: unknown) => runtime.dispatchFetch(`https://broker.example${path}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await post("/token", identity, { worker: "another-worker", scopes: ["workers:edit"] })).status, 403);
    assert.equal((await post("/token", identity, { worker: "one-worker", scopes: ["r2:read"] })).status, 403);
    const { exchange, revoke } = await import("../../../.github/actions/configure-cloudflare-credentials/client.mjs");
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://github.example/")) return Response.json({ value: identity });
      return runtime.dispatchFetch(String(url), init);
    };
    const credential = await exchange({ broker: "https://broker.example", worker: "one-worker", scopes: "workers:edit", requestUrl: "https://github.example/token", requestToken: "request-token" }, fetcher);
    assert.equal(credential.token, "temporary-secret");
    assert.equal(credential.accountId, accountId);
    assert.match(credential.expiresOn, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Date.parse(credential.expiresOn) - Date.now() <= 900_000);
    assert.ok(Date.parse(credential.expiresOn) - Date.now() > 850_000);
    assert.equal((await post("/token", identity, { worker: "one-worker", scopes: ["workers:edit"] })).status, 403);
    assert.equal((await post("/revoke", credential.receipt + "forged")).status, 403);
    await revoke("https://broker.example", credential.receipt, fetcher);
    await revoke("https://broker.example", credential.receipt, fetcher); // idempotent cleanup
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].body.policies, [policy]);
    assert.equal(calls[1].method, "DELETE");
    assert.ok(calls[1].url.endsWith("/" + "b".repeat(32)));
  } finally {
    await runtime.dispose();
  }
});
