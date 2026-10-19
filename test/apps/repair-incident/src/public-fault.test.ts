import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PUBLIC_ERROR_MESSAGE, PUBLIC_FIXTURE_DIGEST, publicFaultFetch } from "./public-fault.ts";

test("served fixture uses the exact bounded broken JavaScript source bytes", async () => {
  const bytes = await readFile(new URL("../fixtures/public-health.js", import.meta.url));
  assert.equal(bytes.toString(), "export function healthStatus() { return 500; }\n");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PUBLIC_FIXTURE_DIGEST);
});

test("only intentional exact GET reaches the fixed HTTP exception", async () => {
  let calls = 0;
  const claim = { claim: async () => (++calls, true) };
  for (const [path, method, headers, status] of [
    ["/", "GET", {}, 404],
    ["/failure?mode=reset", "GET", {}, 404],
    ["/failure", "HEAD", {}, 405],
    ["/failure", "POST", {}, 405],
    ["/failure", "GET", { purpose: "prefetch" }, 412],
    ["/failure", "GET", { "sec-purpose": "prefetch" }, 412],
    ["/failure", "GET", { "x-moz": "prefetch" }, 412],
  ] as const) {
    const response = await publicFaultFetch(
      new Request(`https://owned.invalid${path}`, { method, headers }),
      claim,
    );
    assert.equal(response.status, status);
  }
  assert.equal(calls, 0);
  await assert.rejects(
    publicFaultFetch(new Request("https://owned.invalid/failure"), claim),
    { message: PUBLIC_ERROR_MESSAGE },
  );
  assert.equal(calls, 1);
});

test("claimed or uncertain receipts never replay the error or disclose its cause", async () => {
  const request = () => new Request("https://owned.invalid/failure");
  const already = await publicFaultFetch(request(), { claim: async () => false });
  assert.equal(already.status, 410);
  assert.equal(already.headers.get("cache-control"), "no-store");
  for (const claim of [
    async () => {
      throw new Error("private storage diagnostic");
    },
    async () => "bad receipt" as unknown as boolean,
  ]) {
    const uncertain = await publicFaultFetch(request(), { claim });
    assert.equal(uncertain.status, 409);
    assert.equal(await uncertain.text(), "Owned test claim unavailable");
  }
});
