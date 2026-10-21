import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { showcaseCheckIdentity, showcaseTestCommand } from "./showcase-check-policy.ts";

test("owned showcase test evidence binds the complete enrolled source, dependencies and trusted runtime", async () => {
  const paths = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vite.config.ts", "tsconfig.json", "index.html", "src/app.ts", "src/message.ts", "src/message.test.ts", "packages/greeting/message.ts"].sort();
  const descriptor = { version: 1, uid: 1000, platform: "linux", arch: "x64", runtime: "v24.22.0",
    node: "c".repeat(64), dependencies: "d".repeat(64), dependencyFiles: 12,
    files: paths.map(path => {
      const bytes = readFileSync(new URL(`../../../examples/demo/${path}`, import.meta.url));
      return { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }),
  };
  const revision = "a".repeat(40), version = "11111111-1111-4111-8111-111111111111";
  const identity = await showcaseCheckIdentity(revision, version, JSON.stringify(descriptor));
  assert.equal(identity.stepId, "test");
  assert.equal(identity.command, showcaseTestCommand);
  assert.equal(identity.revision, revision);
  assert.notEqual((await showcaseCheckIdentity(revision, version, JSON.stringify({ ...descriptor, dependencies: "e".repeat(64) }))).sourceDigest, identity.sourceDigest);
  for (const change of [{ uid: 0 }, { platform: "darwin" }, { runtime: "v22.0.0" }, { node: "not a digest" },
    { dependencyFiles: 0 }, { files: descriptor.files.slice(1) },
    { files: descriptor.files.map(file => file.path === "vite.config.ts" ? { ...file, sha256: "f".repeat(64) } : file) }])
    await assert.rejects(showcaseCheckIdentity(revision, version, JSON.stringify({ ...descriptor, ...change })));
  await assert.rejects(showcaseCheckIdentity("main", version, JSON.stringify(descriptor)));
  await assert.rejects(showcaseCheckIdentity(revision, "not a host version", JSON.stringify(descriptor)));
});
