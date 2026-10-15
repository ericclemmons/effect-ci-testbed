import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  syntaxCommand,
  syntaxLocalCommand,
  syntaxIdentity,
  syntaxPaths,
} from "./node-syntax-check.ts";

test("local syntax feedback resolves installed Node and parses without evaluating source", () => {
  const cwd = mkdtempSync(join(tmpdir(), "effect-ci-local-syntax-"));
  mkdirSync(join(cwd, "src"));
  const source = join(cwd, "src/message.ts");
  const run = () =>
    spawnSync("/bin/sh", ["-c", syntaxLocalCommand], {
      cwd,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
      encoding: "utf8",
    });
  writeFileSync(source, 'export const value: string = "ok"; throw new Error("must not execute");');
  assert.equal(run().status, 0);
  writeFileSync(source, "export const value: string = ;");
  assert.notEqual(run().status, 0);
  assert.notEqual(syntaxLocalCommand, syntaxCommand);
  assert.match(syntaxCommand, /\/usr\/local\/bin\/node/);
});

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
