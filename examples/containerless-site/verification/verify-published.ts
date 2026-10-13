import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const tag = "proof-containerless-site-cf6dd38";
const revision = "cf6dd38f2cbb6e89840fb7dc75b6ee681c5eb3c0";
const assets = [
  [
    "video.webm",
    638552506,
    45635,
    "146fe28e266f86b9c600cfac2b5386773534a10c5b8207606652a7dd17ef7914",
  ],
  [
    "002-counter-2.png",
    638552515,
    33311,
    "e6ca3eed04bd83c66d2cd4a112a47bcfbdb5910f58a6b701be23890a11ab981e",
  ],
  [
    "native-cf6dd38.json",
    638552513,
    1642,
    "0543bd5b2a491c4cad98fb9339be7ce92cd8e59c216904f3bc4e61a916fbcc45",
  ],
  [
    "browser-cf6dd38.json",
    638552508,
    1992,
    "9cafc7660b8ffc7a8404457a686a9febcdfd3b144f0edb8c7039b40fd19a0d11",
  ],
  [
    "transcript-cf6dd38.md",
    638552512,
    1605,
    "c8d9fef5fd7fa5676da37da963420dc06c9c58fc11e67a7df76078d723448bdf",
  ],
] as const;
const api = "https://api.github.com/repos/ericclemmons/effect-ci-testbed";
const response = await fetch(`${api}/releases/tags/${tag}`, {
  headers: { accept: "application/vnd.github+json" },
  signal: AbortSignal.timeout(10_000),
});
assert.equal(response.status, 200);
const release = (await response.json()) as {
  tag_name: unknown;
  target_commitish: unknown;
  prerelease: unknown;
  draft: unknown;
  immutable?: boolean;
  assets: { name: string; id: number; size: number; digest: string; state: string }[];
};
assert.equal(release.tag_name, tag);
assert.equal(release.target_commitish, revision);
assert.equal(release.prerelease, true);
assert.equal(release.draft, false);
const ref = await fetch(`${api}/git/ref/tags/${tag}`, { signal: AbortSignal.timeout(10_000) });
assert.equal(ref.status, 200);
const reference = (await ref.json()) as { object: { type: unknown; sha: unknown } };
assert.equal(reference.object.type, "commit");
assert.equal(reference.object.sha, revision);
for (const [name, id, size, sha] of assets) {
  assert.ok(Array.isArray(release.assets));
  const meta = release.assets.find((a) => a.name === name);
  assert.ok(meta, `Missing published asset: ${name}`);
  assert.equal(meta.id, id);
  assert.equal(meta.size, size);
  assert.equal(meta.digest, `sha256:${sha}`);
  assert.equal(meta.state, "uploaded");
  const asset = await fetch(
    `https://github.com/ericclemmons/effect-ci-testbed/releases/download/${tag}/${name}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  assert.equal(asset.status, 200);
  const reader = asset.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      assert.ok(total <= size);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, size);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha);
}
console.log(
  JSON.stringify({
    tag,
    sourceRevision: revision,
    assetsVerified: 5,
    downloadedBytesVerified: true,
    immutable: release.immutable ?? null,
    signedReuseAuthorization: false,
  }),
);
