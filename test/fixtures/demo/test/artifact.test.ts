import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  artifactPaths,
  manifestPath,
  verifyBuildManifest,
  writeBuildManifest,
} from "../.cloudflare/ci/artifact.ts";

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-demo-artifact-"));
  mkdirSync(join(root, "dist"));
  for (const path of artifactPaths)
    writeFileSync(join(root, path), `actual fixture bytes: ${path}`);
  return root;
};

test("actual files produce bounded hashes and verify after copying the published output", () => {
  const producer = fixture();
  const manifest = writeBuildManifest(producer);
  const consumer = mkdtempSync(join(tmpdir(), "effect-ci-demo-artifact-consumer-"));
  mkdirSync(join(consumer, "dist"));
  for (const path of artifactPaths) copyFileSync(join(producer, path), join(consumer, path));
  mkdirSync(join(consumer, ".effect-ci/artifacts"), { recursive: true });
  writeFileSync(join(consumer, manifestPath), readFileSync(join(producer, manifestPath)));
  assert.deepEqual(verifyBuildManifest(consumer), { ...manifest, verified: true });
  // Ordinary repeat builds can replace only this tool's recognized metadata.
  assert.deepEqual(writeBuildManifest(producer), manifest);
});

test("corrupted restored bytes and foreign metadata fail instead of claiming success", () => {
  const root = fixture();
  writeBuildManifest(root);
  writeFileSync(join(root, "dist/message.js"), "corrupted after publish");
  assert.throws(() => verifyBuildManifest(root), /do not match/);
  writeFileSync(join(root, manifestPath), '{"owner":"somebody else"}');
  assert.throws(() => writeBuildManifest(root), /Invalid demo build manifest/);
});

test("symlinked and oversized outputs are not artifact inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-demo-artifact-link-"));
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "outside.html"), "must not read through link");
  symlinkSync("../outside.html", join(root, "dist/index.html"));
  assert.throws(() => writeBuildManifest(root), /regular files/);
  const large = fixture();
  writeFileSync(join(large, "dist/app.js"), Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.throws(() => writeBuildManifest(large), /regular files/);
  const metadata = fixture();
  mkdirSync(join(metadata, ".effect-ci/artifacts"), { recursive: true });
  symlinkSync("missing-target.json", join(metadata, manifestPath));
  assert.throws(() => writeBuildManifest(metadata), /regular files/);
});
