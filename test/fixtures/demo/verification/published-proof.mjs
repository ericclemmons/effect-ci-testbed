const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function verifyPublishedMetadata(receipt, release, tag) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.recipe !== "developer-loop" ||
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(receipt.repository) ||
    !/^[0-9a-f]{40}$/.test(receipt.sourceRevision) ||
    receipt.historical !== true ||
    receipt.signedAttestation !== false ||
    receipt.environment !== "Effect CI Local" ||
    release.id !== receipt.release.id ||
    release.draft !== false ||
    release.tag_name !== receipt.release.tag ||
    release.target_commitish !== receipt.sourceRevision ||
    release.published_at !== receipt.release.publishedAt ||
    tag.ref !== `refs/tags/${receipt.release.tag}` ||
    tag.object?.type !== "commit" ||
    tag.object.sha !== receipt.sourceRevision ||
    !Array.isArray(release.assets) ||
    !Array.isArray(receipt.assets) ||
    receipt.assets.length !== 4 ||
    release.assets.length !== receipt.assets.length ||
    new Set(receipt.assets.map((asset) => asset.id)).size !== receipt.assets.length ||
    new Set(receipt.assets.map((asset) => asset.name)).size !== receipt.assets.length
  ) {
    throw new Error("Published proof source or release mismatch");
  }
  for (const asset of receipt.assets) {
    const matches = release.assets.filter(
      (item) => item.id === asset.id && item.name === asset.name,
    );
    const expectedUrl = `${receipt.repository}/releases/download/${receipt.release.tag}/${asset.name}`;
    if (
      !/^[\w.-]+$/.test(asset.name) ||
      asset.name === "." ||
      asset.name === ".." ||
      !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      matches.length !== 1 ||
      matches[0].size !== asset.bytes ||
      matches[0].state !== "uploaded" ||
      matches[0].digest !== `sha256:${asset.sha256}` ||
      matches[0].browser_download_url !== expectedUrl
    ) {
      throw new Error("Published proof asset identity mismatch");
    }
  }
}

export function verifyPublishedManifest(receipt, manifest) {
  for (const field of [
    "recipe",
    "repository",
    "sourceRevision",
    "runId",
    "environment",
    "scenario",
    "command",
    "expected",
    "actual",
    "signedAttestation",
    "startedAt",
    "buildFinishedAt",
    "browserStartedAt",
    "finishedAt",
    "buildElapsedMs",
    "browserElapsedMs",
    "queueElapsedMs",
    "decisionWaitMs",
    "conditions",
    "runner",
    "engine",
    "browser",
    "runtime",
    "platform",
    "architecture",
    "planMermaid",
  ]) {
    if (!equal(receipt[field], manifest[field]))
      throw new Error("Published receipt differs from original manifest");
  }
  const video = receipt.assets.find((asset) => asset.name === "video.webm");
  if (
    !video ||
    video.sha256 !== manifest.video.sha256 ||
    video.bytes !== manifest.video.bytes ||
    receipt.totalElapsedMs !== Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt) ||
    receipt.sampleCount !== 1 ||
    receipt.queueElapsedMs !== null ||
    receipt.decisionWaitMs !== null ||
    receipt.review.frameworkRedaction !== manifest.video.redaction
  ) {
    throw new Error("Published proof timing or video mismatch");
  }
}
