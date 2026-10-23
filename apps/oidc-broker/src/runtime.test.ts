import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { issuer } from "./auth.ts";

test("actual workerd verifies OIDC, issues once, preserves Worker scope, and revokes through the action client", { timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const pair = await generateKeyPair("RS256");
  const publicKey = { ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256" };
  const accountId = "a".repeat(32);
  const policy = { effect: "allow", permission_groups: [{ id: "individual-workers-editor-fixture" }], resources: { account: { "one-worker-fixture": "*" } } };
  const grant = { repositoryId: "123", repositoryOwnerId: "456", ref: "refs/heads/main", workflowRef: "owner/repo/.github/workflows/deploy.yml@refs/heads/main", accountId, worker: "one-worker", scopes: { "workers:edit": [policy] } };
  // This test-only wrapper intercepts all outbound traffic. No real credentials or network.
  const compiled = await build({
    stdin: { resolveDir: fileURLToPath(new URL("./", import.meta.url)), contents: `
      import worker, {TokenLease} from './worker.ts';
      export {TokenLease};
      const calls=[];
      globalThis.fetch=async(url,init)=>{
        if(String(url)==='${issuer}/.well-known/jwks') return Response.json({keys:[${JSON.stringify(publicKey)}]});
        if(!String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens')) throw Error('Unexpected outbound request');
        if(init.headers.authorization!=='Bearer test-issuer') throw Error('Issuer credential missing');
        calls.push({url:String(url),method:init.method,body:init.body?JSON.parse(init.body):null});
        return Response.json({success:true,result:{id:'${"b".repeat(32)}',value:'temporary-secret'}});
      };
      export default {async fetch(request,env,ctx){
        if(new URL(request.url).pathname==='/__test_calls') return Response.json(calls);
        return worker.fetch(request,env,ctx);
      }};
    ` },
    bundle: true, write: false, format: "esm", platform: "neutral", external: ["cloudflare:workers"],
  });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "oidc-broker-test", compatibilityDate: "2026-10-07",
    env: Object.fromEntries(Object.entries({ BROKER_AUDIENCE: "https://broker.example", BROKER_GRANTS: JSON.stringify([grant]), CLOUDFLARE_TOKEN_ISSUER: "test-issuer", RECEIPT_SIGNING_KEY: "r".repeat(64) }).map(([key, value]) => [key, { type: "text", value }])),
    exports: { TokenLease: { type: "durable-object", storage: "sqlite" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: compiled.outputFiles[0].text } } },
  } }] });
  try {
    const now = Math.floor(Date.now() / 1000);
    const identity = await new SignJWT({ repository_id: "123", repository_owner_id: "456", ref: grant.ref, workflow_ref: grant.workflowRef, run_id: "1", run_attempt: "1", event_name: "workflow_dispatch" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience("https://broker.example")
      .setSubject("repo:owner/repo:ref:refs/heads/main").setJti("test-issuance").setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 300).sign(pair.privateKey);
    const post = (path: string, token: string, body?: unknown) => runtime.dispatchFetch(`https://broker.example${path}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await post("/token", identity, { worker: "another-worker", scopes: ["workers:edit"] })).status, 403);
    assert.equal((await post("/token", identity, { worker: "one-worker", scopes: ["r2:read"] })).status, 403);
    const { exchange, revoke } = await import("../../../.github/actions/cloudflare-auth/client.mjs");
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
    const calls = await (await runtime.dispatchFetch("https://broker.example/__test_calls")).json();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].body.policies, [policy]);
    assert.equal(calls[1].method, "DELETE");
    assert.ok(calls[1].url.endsWith("/" + "b".repeat(32)));
  } finally {
    await runtime.dispose();
  }
});
