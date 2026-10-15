import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { withDemoEvidenceRead } from "./demo-evidence-reader.ts";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = { appId: "5089816", privateKey };
const url =
  "https://api.github.com/repos/ericclemmons/effect-ci-testbed/git/ref/notes/effect-ci-hosted-checks-v1";
const harness = (permissions: Record<string, string> = { contents: "read", metadata: "read" }) => {
  let revoked = 0,
    reads = 0;
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/access_tokens")) {
      assert.equal(init?.redirect, "manual");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        repositories: ["effect-ci-testbed"],
        permissions: { contents: "read" },
      });
      return Response.json({ token: "fixture.token-with-hyphens", permissions });
    }
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer fixture.token-with-hyphens",
    );
    if (String(input).endsWith("/installation/token")) {
      assert.equal(init?.method, "DELETE");
      revoked++;
      return new Response(null, { status: 204 });
    }
    assert.equal(input, url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    reads++;
    return Response.json({ fixture: true });
  };
  return { transport, state: () => ({ revoked, reads }) };
};
test("demo evidence uses only one-repository Contents-read authority and revokes before return", async () => {
  const h = harness();
  assert.equal(
    await withDemoEvidenceRead(
      credentials,
      async (request) => (await request(url)).ok,
      h.transport,
    ),
    true,
  );
  assert.deepEqual(h.state(), { revoked: 1, reads: 1 });
});
test("foreign endpoints, writes, extra permissions and operation failures revoke and fail closed", async () => {
  for (const [target, method] of [
    [url.replace("effect-ci-testbed", "another-repo"), "GET"],
    [url, "POST"],
    [url.replace("ref/notes/effect-ci-hosted-checks-v1", "../issues"), "GET"],
  ]) {
    const h = harness();
    await assert.rejects(
      withDemoEvidenceRead(
        credentials,
        async (request) => (await request(target, { method })).ok,
        h.transport,
      ),
    );
    assert.deepEqual(h.state(), { revoked: 1, reads: 0 });
  }
  for (const permissions of [{ contents: "write" }, { contents: "read", checks: "write" }]) {
    const h = harness(permissions);
    await assert.rejects(
      withDemoEvidenceRead(
        credentials,
        async () => {
          assert.fail("unscoped token reached reader");
        },
        h.transport,
      ),
    );
    assert.deepEqual(h.state(), { revoked: 1, reads: 0 });
  }
  const h = harness();
  await assert.rejects(
    withDemoEvidenceRead(
      credentials,
      async () => {
        throw Error("fixture operation failed");
      },
      h.transport,
    ),
  );
  assert.deepEqual(h.state(), { revoked: 1, reads: 0 });
});
