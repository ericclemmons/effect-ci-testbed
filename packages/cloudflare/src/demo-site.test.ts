import assert from "node:assert/strict";
import test from "node:test";
import { demoAssets, demoSite, demoSiteUrl, siteResponse } from "./demo-site.ts";
const assets = {
  "index.html": "<script type=module src='./app.js'></script>",
  "app.js": "import './message.js'",
  "message.js": "export const message='hello'",
};
test("public demo site identities bind exact UTF-8 bytes, ordered paths and immutable URL", async () => {
  const first = await demoSite("a".repeat(40), assets);
  const again = await demoSite("a".repeat(40), { ...assets });
  assert.deepEqual(first, again);
  assert.notEqual(
    (await demoSite("a".repeat(40), { ...assets, "message.js": "different" })).digest,
    first.digest,
  );
  assert.equal(first.files.length, 3);
  assert.match(
    demoSiteUrl(first),
    /^https:\/\/effect-ci-demo-site\.ericclemmons\.workers\.dev\/r\/[a-f0-9]{40}\/[a-f0-9]{64}\/index.html$/,
  );
  const response = siteResponse(first, "app.js");
  assert.equal(await response.text(), assets["app.js"]);
  assert.match(response.headers.get("content-security-policy")!, /connect-src 'none'/);
  assert.equal(response.headers.get("x-site-digest"), first.digest);
  assert.equal(await siteResponse(first, "index.html", true).text(), "");
  assert.equal(siteResponse(first, "../app.js").status, 404);
});
test("extra files, getters, empty/large bodies and mutable revisions reject", async () => {
  let invoked = 0;
  const getter = { ...assets };
  Object.defineProperty(getter, "app.js", {
    get() {
      invoked++;
      return "wrong";
    },
  });
  for (const invalid of [
    getter,
    { ...assets, extra: "x" },
    { ...assets, "message.js": "" },
    { ...assets, "app.js": "x".repeat(256 * 1024 + 1) },
  ])
    assert.throws(() => demoAssets(invalid));
  assert.equal(invoked, 0);
  await assert.rejects(demoSite("main", assets));
});
