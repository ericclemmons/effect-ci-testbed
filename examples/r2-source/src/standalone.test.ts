import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { sourceParameters } from "./parameters.ts";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("owned host selects only an opaque content-addressed key in its private bucket", () => {
  const p = { repository: `source/${"a".repeat(64)}.json`, revision: "b".repeat(64) };
  assert.deepEqual(sourceParameters(p), p); // Key spelling is not the trusted digest.
  let invoked = false;
  for (const v of [null, [], {}, { ...p, token: "caller" }, { ...p, [Symbol()]: true },
    { ...p, repository: "https://foreign.invalid/source.json" }, { ...p, revision: "latest" },
    { ...p, get repository() { invoked = true; return p.repository; } }]) assert.throws(() => sourceParameters(v));
  assert.equal(invoked, false);
});
test("recipe owns its config, image and fixture and imports only packages/owned modules", () => {
  const config = read("cloudflare.config.ts");
  assert.match(config, /SOURCE_BUCKET: bindings\.r2\(\{ name: "effect-ci-r2-source-input" \}\)/);
  assert.match(config, /workersDev: false/); assert.match(config, /previewUrls: false/);
  assert.match(config, /dockerfile: "\.\/Dockerfile"/); assert.match(config, /name: "effect-ci-r2-source-checks"/);
  for (const p of ["cloudflare.config.ts", "vite.config.ts", "tsconfig.json", "Dockerfile", "src/worker.ts", ".cloudflare/ci/standalone.ts"])
    assert.doesNotMatch(read(p), /apps\/|(?:\.\.\/){2,}.*examples\//, p);
  assert.ok(!Object.hasOwn(JSON.parse(read("tsconfig.json")), "extends"));
  assert.equal(createHash("sha256").update(read("source.json")).digest("hex"), "6759fef7f59ccbd363fb8c42062fb4903d98070d08da56c6ae873d9a75ea41cd");
  assert.match(read("Dockerfile"), /FROM node:24-trixie-slim@sha256:/);
  assert.doesNotMatch(read("Dockerfile"), /COPY (?:\.|\.\.)/);
});
