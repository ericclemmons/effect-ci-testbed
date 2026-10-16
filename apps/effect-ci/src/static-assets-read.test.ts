import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { readOwnedStaticAssets } from "./static-assets-read.ts";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const credentials = { appId: "5089816", privateKey }, revision = "a".repeat(40), tree = "b".repeat(40);
const blob = createHash("sha1").update("blob 5\0hello").digest("hex");
function harness(options: { revokeFailure?: boolean; readFailure?: boolean; permissions?: object } = {}) {
  const state = { minted: 0, read: 0, revoked: 0 };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/access_tokens")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { repositories: ["effect-ci-testbed"], permissions: { contents: "read" } });
      state.minted++;
      return Response.json({ token: "private.fixture.token", permissions: options.permissions ?? { contents: "read", metadata: "read" } });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private.fixture.token");
    if (url.endsWith("/installation/token")) { state.revoked++; assert.equal(init?.method, "DELETE"); return new Response(null, { status: options.revokeFailure ? 500 : 204 }); }
    state.read++;
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "manual");
    if (options.readFailure) throw Error("private.fixture.token sensitive upstream body");
    if (url.endsWith(`commits/${revision}`)) return Response.json({ sha: revision, tree: { sha: tree } });
    if (url.endsWith(`trees/${tree}?recursive=1`)) return Response.json({ sha: tree, truncated: false,
      tree: ["app.js", "index.html", "style.css"].map(name => ({ path: `examples/static-assets-source/site/${name}`, mode: "100644", type: "blob", size: 5, sha: blob })) });
    assert.ok(url.endsWith(`blobs/${blob}`));
    return Response.json({ sha: blob, size: 5, encoding: "base64", content: "aGVsbG8=" });
  };
  return { state, transport };
}
test("owned source token is one-repository read-only and revoked before bytes return", async () => {
  const h = harness(), result = await readOwnedStaticAssets(credentials, revision, h.transport);
  assert.deepEqual(h.state, { minted: 1, read: 5, revoked: 1 });
  assert.equal(result.revision, revision);
  assert.ok(!JSON.stringify(result).includes("private.fixture.token"));
});
test("invalid revision never mints; source, permission and cleanup failures revoke and redact", async () => {
  const invalid = harness(); await assert.rejects(readOwnedStaticAssets(credentials, "main", invalid.transport));
  assert.equal(invalid.state.minted, 0);
  for (const options of [{ readFailure: true }, { revokeFailure: true }, { permissions: { contents: "write" } }]) {
    const h = harness(options);
    await assert.rejects(readOwnedStaticAssets(credentials, revision, h.transport), { message: "Static source read unavailable" });
    assert.equal(h.state.minted, 1); assert.equal(h.state.revoked, 1);
    if ("permissions" in options) assert.equal(h.state.read, 0);
  }
});
