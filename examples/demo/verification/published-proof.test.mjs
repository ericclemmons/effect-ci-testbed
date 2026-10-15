import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { verifyPublishedMetadata, verifyPublishedManifest } from "./published-proof.mjs";
const receipt = JSON.parse(
  readFileSync(new URL("./published/local-4ebc193.json", import.meta.url), "utf8"),
);
const metadata = () => ({
  id: receipt.release.id,
  draft: false,
  tag_name: receipt.release.tag,
  target_commitish: receipt.sourceRevision,
  published_at: receipt.release.publishedAt,
  assets: receipt.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    size: asset.bytes,
    state: "uploaded",
    digest: `sha256:${asset.sha256}`,
    browser_download_url: `${receipt.repository}/releases/download/${receipt.release.tag}/${asset.name}`,
  })),
});
const tag = () => ({
  ref: `refs/tags/${receipt.release.tag}`,
  object: { type: "commit", sha: receipt.sourceRevision },
});
const manifest = () => ({
  ...receipt,
  video: {
    sha256: receipt.assets[0].sha256,
    bytes: receipt.assets[0].bytes,
    redaction: "incomplete",
  },
});

test("published proof is explicitly historical, local and unsigned", () => {
  verifyPublishedMetadata(receipt, metadata(), tag());
  verifyPublishedManifest(receipt, manifest());
  assert.equal(receipt.historical, true);
  assert.equal(receipt.signedAttestation, false);
  assert.equal(receipt.review.frameworkRedaction, "incomplete");
  const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  assert.ok(readme.includes(receipt.planMermaid), "recorded command plan comes from the manifest");
});
test("retagging, draft/source mismatch, missing and replaced assets fail closed", () => {
  for (const change of [{ draft: true }, { target_commitish: "main" }, { assets: [] }, { id: 0 }])
    assert.throws(() => verifyPublishedMetadata(receipt, { ...metadata(), ...change }, tag()));
  const replaced = metadata();
  replaced.assets[0].digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => verifyPublishedMetadata(receipt, replaced, tag()));
  const extra = metadata();
  extra.assets.push({ ...extra.assets[0], id: 0, name: "unreviewed.txt" });
  assert.throws(() => verifyPublishedMetadata(receipt, extra, tag()));
  assert.throws(() =>
    verifyPublishedMetadata(
      { ...receipt, assets: Array(4).fill(receipt.assets[0]) },
      metadata(),
      tag(),
    ),
  );
  const redirected = metadata();
  redirected.assets[0].browser_download_url = "https://evil.invalid/video.webm";
  assert.throws(() => verifyPublishedMetadata(receipt, redirected, tag()));
  assert.throws(() =>
    verifyPublishedMetadata(receipt, metadata(), {
      ...tag(),
      object: { type: "commit", sha: "0".repeat(40) },
    }),
  );
});
test("outcomes, plan, runtime, unknown waits and original redaction status cannot be rewritten", () => {
  for (const change of [
    { actual: "failed" },
    { sourceRevision: "0".repeat(40) },
    { planMermaid: "invented" },
    { browser: "different" },
    { engine: { ...receipt.engine, spiVersion: 0 } },
    { queueElapsedMs: 0 },
    { browserElapsedMs: 0 },
    { video: { ...manifest().video, redaction: "complete" } },
  ])
    assert.throws(() => verifyPublishedManifest(receipt, { ...manifest(), ...change }));
});
