import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { original, changed, programChanged, publicSource, sourceRoot } from "./source.ts";

for (const revision of [original, changed, programChanged]) {
  test(`fixed public source bytes match actual Git objects: ${revision}`, async () => {
    const requested: string[] = [];
    const files = await publicSource(revision, (async (url: string, options: RequestInit) => {
      requested.push(url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers, undefined, "No credential or actor-provided headers");
      const name = url.split("/").at(-1)!;
      return new Response(execFileSync("git", ["show", `${revision}:${sourceRoot}/${name}`]));
    }) as typeof fetch);
    assert.equal(files.length, 3);
    assert.equal(requested.length, 3);
    for (const file of files) assert.equal(Buffer.from(file.base64, "base64").toString(), execFileSync("git", ["show", `${revision}:${file.path}`], { encoding: "utf8" }));
  });
}

test("unknown source, altered bytes, oversized responses and HTTP failures cannot prepare a VM", async () => {
  let called = false;
  await assert.rejects(publicSource("a".repeat(40), (async () => { called = true; return new Response(); }) as typeof fetch), /Unapproved/);
  assert.equal(called, false);
  for (const response of [new Response("tampered"), new Response("x".repeat(16385)), new Response("upstream diagnostics", { status: 403 }), new Response(null, { status: 302, headers: { Location: "https://example.invalid" } })]) {
    await assert.rejects(publicSource(original, (async () => response) as typeof fetch), /Git blob mismatch|too large|unavailable/);
  }
});
