import assert from "node:assert/strict";
import test from "node:test";
import { syntaxIdentity, syntaxPaths } from "./node-syntax-check.ts";

const descriptor = {
  version: 1,
  files: syntaxPaths.map((path) => ({ path, size: 100, sha256: "a".repeat(64) })),
  node: "b".repeat(64),
  runtime: "v24.22.0",
  platform: "linux",
  arch: "x64",
  versions: { node: "24.22.0", v8: "test" },
};
test("syntax identity binds actual source bytes and exact Linux Node executable/runtime", async () => {
  const first = await syntaxIdentity("a".repeat(40), JSON.stringify(descriptor));
  const source = structuredClone(descriptor);
  source.files[0]!.sha256 = "c".repeat(64);
  assert.notEqual(
    (await syntaxIdentity(first.revision, JSON.stringify(source))).sourceDigest,
    first.sourceDigest,
  );
  assert.notEqual(
    (await syntaxIdentity(first.revision, JSON.stringify({ ...descriptor, node: "c".repeat(64) })))
      .toolchainDigest,
    first.toolchainDigest,
  );
  for (const patch of [
    { platform: "darwin" },
    { arch: "arm64" },
    { node: "major-version-only" },
    { runtime: "v26.0.0" },
    { files: descriptor.files.slice(1) },
  ]) {
    await assert.rejects(
      syntaxIdentity(first.revision, JSON.stringify({ ...descriptor, ...patch })),
    );
  }
  await assert.rejects(syntaxIdentity("main", JSON.stringify(descriptor)));
  await assert.rejects(syntaxIdentity(first.revision, "x".repeat(8193)));
});
