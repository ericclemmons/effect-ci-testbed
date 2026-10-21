import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { demoBuildIdentity, demoTrustedNodeBase, demoRunnerInspectCommand } from "./demo-runner-policy.ts";

test("build results bind the actual host deployment, not only a mutable image label", async () => {
  const first = await demoBuildIdentity("a".repeat(40), "11111111-1111-4111-8111-111111111111");
  const next = await demoBuildIdentity("a".repeat(40), "22222222-2222-4222-8222-222222222222");
  assert.notEqual(first.runtimeDigest, next.runtimeDigest);
  assert.notEqual(first.policyDigest, next.policyDigest);
  await assert.rejects(demoBuildIdentity("a".repeat(40), "unversioned"));
});

test("trusted demo can build without private registry access and cannot send project secrets as Docker context", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile.trusted-demo", import.meta.url), "utf8");
  assert.ok(dockerfile.includes(`FROM ${demoTrustedNodeBase}`));
  assert.doesNotMatch(dockerfile, /registry\.cloudflare\.com/);
  assert.match(dockerfile, /^USER node$/m);
  assert.deepEqual(readFileSync(new URL("../.dockerignore", import.meta.url), "utf8").trim().split("\n"),
    ["**", "!Dockerfile", "!Dockerfile.trusted-demo", "!Dockerfile.showcase", "!showcase-verify-build.cjs", "!Dockerfile.standalone",
      "!.standalone-runtime", "!.standalone-runtime/package.json", "!.standalone-runtime/src",
      "!.standalone-runtime/src/**", "!.standalone-runtime/node_modules", "!.standalone-runtime/node_modules/**"]);
  for (const suite of [false, true]) assert.match(demoRunnerInspectCommand(suite), /process\.getuid\?\.\(\)!==1000/);
});
