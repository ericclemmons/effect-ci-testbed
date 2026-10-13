import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";

export function verifyReport(run, negative) {
  const expected = negative ? "failed" : "passed";
  const result = run.results?.[0];
  const attempt = result?.attempts?.[0];
  if (run.status !== expected || run.exitCode !== (negative ? 1 : 0) || run.results?.length !== 1 ||
      result?.status !== expected || result?.attempts?.length !== 1 || attempt?.status !== expected ||
      attempt?.cleanup !== "complete" || attempt?.secondaryErrors?.length !== 0) {
    throw new Error("Unexpected recorded outcome or incomplete cleanup");
  }
  const steps = attempt.steps ?? [];
  const last = steps.at(-1);
  if (!steps.length || !steps.some((step) => step.kind === "assertion") ||
      (negative ? !(last?.kind === "assertion" && last.api === "expect.toHaveText" &&
        last.status === "failed" && attempt.error?.code === "ASSERTION_FAILED" &&
        steps.slice(0, -1).every((step) => step.status === "passed"))
        : !steps.every((step) => step.status === "passed"))) {
    throw new Error("Missing actual assertions or wrong failure category");
  }
  const start = Date.parse(run.startedAt);
  const finish = Date.parse(run.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) throw new Error("Invalid run timing");
  const videos = attempt.artifacts.filter((artifact) => artifact.kind === "video");
  if (videos.length !== 1 || videos[0].mediaType !== "video/webm") throw new Error("Expected one actual WebM recording");
  const videoStart = Date.parse(videos[0].startedAt);
  if (!Number.isFinite(videoStart) || videoStart < start || videoStart > finish) throw new Error("Video is outside the run window");
  return videos[0];
}

export function verifyVideo(videoRoot, video) {
  const root = resolve(videoRoot);
  const path = resolve(root, video.path);
  if (!path.startsWith(root + sep) || !realpathSync(path).startsWith(realpathSync(root) + sep)) {
    throw new Error("Invalid video path");
  }
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length < 1000 || bytes.length > 50 * 1024 * 1024 || bytes.length !== video.size || sha256 !== video.sha256) {
    throw new Error("Video size/digest mismatch");
  }
  return { bytes: bytes.length, sha256 };
}
