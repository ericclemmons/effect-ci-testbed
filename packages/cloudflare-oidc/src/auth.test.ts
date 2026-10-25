import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { authorize, cloudflareTokenRequest, issuer, verifyIdentity, type Grant } from "./auth.ts";

const accountId = "a".repeat(32);
// Opaque resource keys deliberately stand in for the operator's exported CF policy.
const edit = { effect: "allow" as const, permission_groups: [{ id: "editor-group" }], resources: { account: { "individual-worker-fixture": "*" } } };
const r2 = { effect: "allow" as const, permission_groups: [{ id: "r2-read-group" }], resources: { "r2-fixture": "*" } };
const claims = { repository_id: "123", repository_owner_id: "456", ref: "refs/heads/main", workflow_ref: "owner/repo/.github/workflows/deploy.yml@refs/heads/main", event_name: "workflow_dispatch" };
const grant: Grant = { repositoryId: "123", repositoryOwnerId: "456", ref: claims.ref, workflowRef: claims.workflow_ref, accountId, worker: "my-worker", scopes: { "workers:edit": [edit], "r2:read": [r2] } };

test("only requested policies are issued; Worker resource restriction survives unchanged", () => {
  assert.deepEqual(authorize(claims, { worker: "my-worker", scopes: ["workers:edit"] }, [grant]), { accountId, policies: [edit] });
  assert.deepEqual(authorize(claims, { worker: "my-worker", scopes: ["workers:edit", "r2:read", "workers:edit"] }, [grant]).policies, [edit, r2]);
});

test("unknown scopes, empty scopes, other Workers, fork identity and PR events fail closed", () => {
  for (const request of [{ worker: "my-worker", scopes: [] }, { worker: "my-worker", scopes: ["admin"] }, { worker: "another-worker", scopes: ["workers:edit"] }]) {
    assert.throws(() => authorize(claims, request, [grant]));
  }
  for (const changed of [{ repository_id: "other" }, { repository_owner_id: "other" }, { ref: "refs/heads/other" }, { workflow_ref: "other" }, { event_name: "pull_request" }, { event_name: "pull_request_target" }]) {
    assert.throws(() => authorize({ ...claims, ...changed }, { worker: "my-worker", scopes: ["workers:edit"] }, [grant]));
  }
});

test("repository wildcard accepts different repositories only within the configured owner", () => {
  const wildcard: Grant = { ...grant, repositoryId: "*", workflowRef: "owner/*/.github/workflows/deploy.yml@refs/heads/main" };
  for (const [repository_id, repository] of [["123", "repo"], ["789", "another-repo"]]) {
    assert.deepEqual(authorize({ ...claims, repository_id, workflow_ref: `owner/${repository}/.github/workflows/deploy.yml@refs/heads/main` },
      { worker: "my-worker", scopes: ["workers:edit"] }, [wildcard]), { accountId, policies: [edit] });
  }
});

test("repository wildcard preserves owner, branch, workflow, Worker, scope and event restrictions", () => {
  const wildcard: Grant = { ...grant, repositoryId: "*", workflowRef: "owner/*/.github/workflows/deploy.yml@refs/heads/main" };
  const request = { worker: "my-worker", scopes: ["workers:edit"] };
  for (const changed of [
    { repository_owner_id: "999" }, { repository_id: undefined }, { repository_id: "*" },
    { ref: "refs/heads/feature" },
    { workflow_ref: "other/repo/.github/workflows/deploy.yml@refs/heads/main" },
    { workflow_ref: "owner/repo/.github/workflows/other.yml@refs/heads/main" },
    { workflow_ref: "owner/repo/.github/workflows/deploy.yml@refs/heads/feature" },
    { workflow_ref: "owner//.github/workflows/deploy.yml@refs/heads/main" },
    { event_name: "pull_request" }, { event_name: "pull_request_target" },
  ]) assert.throws(() => authorize({ ...claims, ...changed }, request, [wildcard]));
  for (const changed of [{ worker: "another-worker" }, { scopes: ["admin"] }]) {
    assert.throws(() => authorize(claims, { ...request, ...changed }, [wildcard]));
  }
  for (const changed of [
    { repositoryOwnerId: "*" }, { repositoryOwnerId: "" },
    { workflowRef: "*/*/.github/workflows/deploy.yml@refs/heads/main" },
    { workflowRef: "owner/*/.github/workflows/*@refs/heads/main" },
    { workflowRef: "owner/*/.github/workflows/deploy.yml@*" },
  ]) assert.throws(() => authorize(claims, request, [{ ...wildcard, ...changed }]));
});

test("owner-wide grants accept repositories, branches, tags, workflow names and automation events", () => {
  const ownerGrant: Grant = { ...grant, repositoryId: "*", ref: "*", workflowRef: "*" };
  const request = { worker: "my-worker", scopes: ["workers:edit"] };
  for (const [ref, event_name] of [["refs/heads/main", "push"], ["refs/heads/feature/new", "workflow_dispatch"], ["refs/tags/v1", "release"], ["refs/heads/main", "schedule"], ["refs/heads/main", "workflow_run"]]) {
    assert.deepEqual(authorize({ ...claims, repository_id: "789", ref, event_name,
      workflow_ref: `owner/new-repository/.github/workflows/renamed.yml@${ref}` }, request, [ownerGrant]), { accountId, policies: [edit] });
  }
  for (const changed of [{ repository_owner_id: "999" }, { repository_owner_id: "*" }, { repository_id: undefined }, { ref: undefined }, { workflow_ref: "" }, { event_name: "pull_request" }, { event_name: "pull_request_target" }]) {
    assert.throws(() => authorize({ ...claims, ...changed }, request, [ownerGrant]));
  }
  assert.throws(() => authorize(claims, { ...request, worker: "other-worker" }, [ownerGrant]));
  assert.throws(() => authorize(claims, { ...request, scopes: ["admin"] }, [ownerGrant]));
});

const pair = await generateKeyPair("RS256");
const jwk = await exportJWK(pair.publicKey);
const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "github-test", alg: "RS256" }] });
const audience = "https://broker.example";
async function identity(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims, run_id: "99", run_attempt: "1", jti: "unique", sub: "repo:owner/repo:ref:refs/heads/main", iss: issuer, aud: audience, iat: now, nbf: now, exp: now + 300, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "github-test" }).sign(pair.privateKey);
}
test("real JWT signature verification accepts GitHub identity", async () => {
  assert.equal((await verifyIdentity(await identity(), audience, keys)).repository_id, "123");
});
test("wrong audience, issuer, expiry, age, missing claims and forged signatures fail", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const overrides of [{ aud: "other" }, { iss: "other" }, { exp: now - 1 }, { iat: now - 700 }, { nbf: now + 60 }, { jti: undefined }, { repository_id: undefined }]) {
    await assert.rejects(verifyIdentity(await identity(overrides), audience, keys));
  }
  const token = await identity();
  const parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ ...claims, repository_id: "attacker" })).toString("base64url");
  await assert.rejects(verifyIdentity(parts.join("."), audience, keys));
});
test("Cloudflare issuance forwards exact policy and expiration; errors never reflect secrets", async () => {
  const body = { policies: [edit], expires_on: "2026-10-23T00:15:00Z" };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer issuer-secret");
    assert.equal(init?.redirect, "manual");
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    return Response.json({ success: true, result: { id: "b".repeat(32), value: "temporary-secret" } });
  };
  assert.equal((await cloudflareTokenRequest(accountId, "issuer-secret", "POST", body, fetcher))?.value, "temporary-secret");
  await assert.rejects(cloudflareTokenRequest(accountId, "issuer-secret", "POST", body,
    async () => new Response("reflected-secret", { status: 403 })), /^Error: Cloudflare token operation failed \(403\)$/);
});
test("revocation uses the account token endpoint and no credential-bearing body", async () => {
  await cloudflareTokenRequest(accountId, "issuer-secret", "DELETE", "token-id", async (url, init) => {
    assert.equal(String(url), `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/token-id`);
    assert.equal(init?.method, "DELETE");
    assert.equal(init?.body, undefined);
    return Response.json({ success: true, result: { id: "token-id" } });
  });
});
