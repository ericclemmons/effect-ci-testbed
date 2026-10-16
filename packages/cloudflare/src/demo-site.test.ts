import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
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
  const response = await siteResponse(first, "app.js");
  assert.equal(await response.text(), assets["app.js"]);
  assert.match(response.headers.get("content-security-policy")!, /connect-src 'none'/);
  assert.equal(response.headers.get("x-site-digest"), first.digest);
  assert.equal(await (await siteResponse(first, "index.html", true)).text(), "");
  assert.equal((await siteResponse(first, "../app.js")).status, 404);
});
test("immutable HTML permits only its exact style-element hashes, not inline scripts or attributes", async () => {
  const css = "\nbody { color: red }\n";
  const site = await demoSite("a".repeat(40), { ...assets,
    "index.html": `<style>${css}</style><style>h1{color:blue}</style><script>bad()</script><p style='color:green'>x</p>` });
  const expected = [css, "h1{color:blue}"].map(s => `'sha256-${createHash("sha256").update(s).digest("base64")}'`);
  const response = await siteResponse(site, "index.html");
  const csp = response.headers.get("content-security-policy")!;
  assert.equal(csp.split("; ").find(s => s.startsWith("style-src")), `style-src 'self' ${expected.join(" ")}`);
  assert.match(csp, /script-src 'self';/); assert.match(csp, /connect-src 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval|unsafe-hashes|nonce-/.test(csp));
  assert.equal(await response.text(), site.assets["index.html"]);
  assert.equal((await siteResponse(site, "index.html", true)).headers.get("content-security-policy"), csp);
  const changed = await demoSite("b".repeat(40), { ...assets, "index.html": `<style>${css} </style>` });
  assert.ok(!(await siteResponse(changed, "index.html")).headers.get("content-security-policy")!.includes(expected[0]!));
  assert.ok(!(await siteResponse(site, "app.js")).headers.get("content-security-policy")!.includes("sha256-"));
  const excess = await demoSite("c".repeat(40), { ...assets, "index.html": "<style>x{}</style>".repeat(9) });
  await assert.rejects(siteResponse(excess, "index.html"), /Style element limit/);
  const normalized = await demoSite("d".repeat(40), { ...assets, "index.html": "<style>\r\nx{}\r\0</style>" });
  assert.ok((await siteResponse(normalized, "index.html")).headers.get("content-security-policy")!.includes(
    createHash("sha256").update("\nx{}\n\uFFFD").digest("base64")));
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
