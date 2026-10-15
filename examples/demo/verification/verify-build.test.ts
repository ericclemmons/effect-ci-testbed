import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyBuild } from "../.cloudflare/ci/verify-build.ts";

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-build-output-"));
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist/index.html"), "<!doctype html><h1>Demo</h1>");
  writeFileSync(join(root, "dist/app.js"), "import './message.js';");
  writeFileSync(join(root, "dist/message.js"), 'export const message = "ready";');
  return root;
};

test("inherited build verification only reads outputs, without artifact/cache metadata", () => {
  const root = fixture();
  const first = verifyBuild(root);
  assert.equal(first.verified, true);
  assert.deepEqual(readdirSync(root), ["dist"]);
  assert.deepEqual(verifyBuild(root), first);
  writeFileSync(join(root, "dist/message.js"), 'export const message = "changed";');
  assert.notEqual(verifyBuild(root).files[2]!.sha256, first.files[2]!.sha256);
  assert.deepEqual(readdirSync(root), ["dist"]);
});

test("missing, empty, symlinked and oversized build outputs reject", () => {
  const missing = mkdtempSync(join(tmpdir(), "effect-ci-missing-build-"));
  assert.throws(() => verifyBuild(missing));
  const empty = fixture();
  writeFileSync(join(empty, "dist/app.js"), "");
  assert.throws(() => verifyBuild(empty));
  const oversized = fixture();
  writeFileSync(join(oversized, "dist/app.js"), "x".repeat(2 * 1024 * 1024 + 1));
  assert.throws(() => verifyBuild(oversized));
  const link = mkdtempSync(join(tmpdir(), "effect-ci-linked-build-"));
  symlinkSync(join(fixture(), "dist"), join(link, "dist"));
  assert.throws(() => verifyBuild(link));
});
