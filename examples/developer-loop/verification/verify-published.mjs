import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { verifyPublishedMetadata, verifyPublishedManifest } from "./published-proof.mjs";

const receipt = JSON.parse(
  readFileSync(new URL("./published/local-4ebc193.json", import.meta.url), "utf8"),
);
const read = async (url, limit) => {
  // Public-only verification: no token, cookie, account session or publication writes.
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error("Public proof response unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error("Public proof response exceeds bound");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
};
try {
  const api = receipt.repository.replace("https://github.com/", "https://api.github.com/repos/");
  const release = JSON.parse(await read(`${api}/releases/${receipt.release.id}`, 1_048_576));
  const tag = JSON.parse(await read(`${api}/git/ref/tags/${receipt.release.tag}`, 16_384));
  verifyPublishedMetadata(receipt, release, tag);
  let manifest;
  for (const asset of receipt.assets) {
    const bytes = await read(
      `${receipt.repository}/releases/download/${receipt.release.tag}/${asset.name}`,
      asset.bytes,
    );
    if (
      bytes.length !== asset.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256
    )
      throw new Error("Public proof asset bytes differ");
    if (asset.name.endsWith(".json")) manifest = JSON.parse(bytes);
  }
  verifyPublishedManifest(receipt, manifest);
  console.log(
    JSON.stringify({
      verified: true,
      sourceRevision: receipt.sourceRevision,
      runId: receipt.runId,
      environment: receipt.environment,
      assets: receipt.assets.length,
      actual: receipt.actual,
      historical: true,
      signedAttestation: false,
    }),
  );
} catch (error) {
  const safeReasons = [
    "Published proof source or release mismatch",
    "Published proof asset identity mismatch",
    "Published receipt differs from original manifest",
    "Published proof timing or video mismatch",
    "Public proof response unavailable",
    "Public proof response exceeds bound",
    "Public proof asset bytes differ",
  ];
  if (error instanceof Error && safeReasons.includes(error.message)) console.error(error.message);
  console.error(
    "Published proof verification failed: source, availability, metadata or bytes did not match. No publication or CI dispatch performed.",
  );
  process.exitCode = 1;
}
