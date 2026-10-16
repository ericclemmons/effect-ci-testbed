import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { FIXED_SOURCE, REPAIR_REPOSITORY } from "./repair.ts";
import { HOST_CHECK_NAME, OWNED_NODE_COMMAND, readOwnedRepairVerification } from "./repair-verifier.ts";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const credentials = { appId: "5089816", privateKey }, commit = "c".repeat(40), run = "owned";
const digest = createHash("sha256").update(FIXED_SOURCE).digest("hex");
test("retained native check reconciliation has read-only tokens, exact evidence, and no execution/write callback", async () => {
  let revoked = 0, reads = 0;
  const check = { id: 123, app: { id: 5089816 }, head_sha: commit, name: HOST_CHECK_NAME,
    external_id: `owned-native-repair:${run}:${commit}:${digest}`, status: "completed", conclusion: "success",
    output: { summary: `Exact commit: ${commit}\nSource SHA-256: ${digest}\nCommand: ${OWNED_NODE_COMMAND}\nThree pinned files fetched from this commit and materialized without credentials. Actual native Node exit code: 0.\nNo merge or deployment.` } };
  let response: any = check;
  const fetcher: typeof fetch = async (url, init) => {
    const u = new URL(String(url)); assert.equal(u.origin, "https://api.github.com");
    if (u.pathname === "/app/installations/165265172/access_tokens") {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, { repositories: ["effect-ci-private-github-fixture"], permissions: { contents: "read", pull_requests: "read", checks: "read" } });
      return Response.json({ token: "LOCAL-read-token", permissions: { ...body.permissions, metadata: "read" } });
    }
    if (u.pathname === "/installation/token") { assert.equal(init?.method, "DELETE"); revoked++; return new Response(null, { status: 204 }); }
    assert.equal(init?.method, "GET"); assert.equal(u.pathname, `/repos/${REPAIR_REPOSITORY}/check-runs/123`);
    reads++; return Response.json(response);
  };
  const result = await readOwnedRepairVerification(credentials, commit, run, "github_check_123", fetcher);
  assert.deepEqual(result, { commit, sourceDigest: digest, evidenceId: "github_check_123", passed: true });
  for (const patch of [{ id: 456 }, { app: { id: 1 } }, { head_sha: "d".repeat(40) }, { conclusion: "failure" },
    { status: "in_progress" }, { external_id: "foreign" }, { output: { summary: "claimed healthy" } }]) {
    response = { ...check, ...patch };
    await assert.rejects(readOwnedRepairVerification(credentials, commit, run, "github_check_123", fetcher));
  }
  assert.equal(reads, 8); assert.equal(revoked, 8);
  await assert.rejects(readOwnedRepairVerification(credentials, commit, run, "github_check_0", fetcher));
  assert.equal(reads, 8);
});
