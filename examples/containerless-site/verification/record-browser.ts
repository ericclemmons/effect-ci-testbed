import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, lstat, readFile, writeFile, realpath } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { REVISION } from "./native.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const clean = () => {
  if (git("diff", "HEAD") || git("ls-files", "--others", "--exclude-standard", "--", "."))
    throw new Error("Commit the recipe before recording");
};
if (process.argv.length !== 2) throw new Error("No caller-selected URL, scenario or output path");
clean();
const harnessRevision = git("rev-parse", "HEAD");
const nativeBytes = await readFile(resolve(root, ".verification/native-cf6dd38.json"));
const native = JSON.parse(nativeBytes.toString());
assert.equal(native.original.sourceRevision, REVISION);
assert.equal(native.original.run.status, "complete");
const id = randomUUID();
const captures = resolve(root, "captures");
await mkdir(captures, { recursive: true });
if ((await lstat(captures)).isSymbolicLink()) throw new Error("Unsafe capture directory");
const output = resolve(captures, id);
await mkdir(output); // create-only: no recorder can erase another run
const startedAt = new Date().toISOString();
const result = spawnSync("e2e", ["run", "verification/site.e2e.ts", "--output", output], {
  cwd: root,
  encoding: "utf8",
  timeout: 60_000,
  env: { ...process.env, E2E_TELEMETRY_DISABLED: "1" },
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
const finishedAt = new Date().toISOString();
assert.equal(result.error, undefined);
assert.equal(result.status, 0);
const reportBytes = await readFile(resolve(output, "report.json"));
const run = JSON.parse(reportBytes.toString()).run;
const selected = run.results.filter((r: any) => r.selected === true && r.kind === "test");
assert.equal(run.status, "passed");
assert.equal(run.exitCode, 0);
assert.equal(run.errors.length, 0);
assert.equal(selected.length, 1);
const test = selected[0];
assert.equal(test.status, "passed");
assert.equal(test.attempts.length, 1);
const attempt = test.attempts[0];
assert.equal(attempt.status, "passed");
assert.equal(attempt.cleanup, "complete");
assert.equal(attempt.secondaryErrors.length, 0);
assert.ok(attempt.steps.every((s: any) => s.status === "passed"));
assert.equal(attempt.steps.filter((s: any) => s.kind === "assertion").length, 3);
const videos = attempt.artifacts.filter((a: any) => a.kind === "video");
assert.equal(videos.length, 1);
const video = videos[0];
assert.equal(video.mediaType, "video/webm");
const videoPath = resolve(output, "results", video.path);
const actualPath = await realpath(videoPath);
if (!actualPath.startsWith((await realpath(resolve(output, "results"))) + sep))
  throw new Error("Unsafe media path");
const bytes = await readFile(actualPath);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
assert.equal(bytes.length, video.size);
assert.equal(sha(bytes), video.sha256);
assert.ok(bytes.length > 1000 && bytes.length < 50 * 1024 * 1024);
assert.ok(
  Date.parse(video.startedAt) >= Date.parse(run.startedAt) &&
    Date.parse(video.startedAt) <= Date.parse(run.finishedAt),
);
clean();
assert.equal(git("rev-parse", "HEAD"), harnessRevision);
const manifest = {
  schemaVersion: 1,
  recipe: "containerless-site",
  sourceRevision: REVISION,
  harnessRevision,
  nativeInstanceId: native.original.instanceId,
  nativeReceiptSha256: sha(nativeBytes),
  siteUrl: native.original.siteUrl,
  recordingId: id,
  browserRunId: run.id,
  startedAt,
  finishedAt,
  expected: "passed",
  actual: run.status,
  assertions: 3,
  cleanup: attempt.cleanup,
  video: { path: actualPath, bytes: bytes.length, sha256: sha(bytes) },
  reportSha256: sha(reportBytes),
  browserElapsedMs: Date.parse(finishedAt) - Date.parse(startedAt),
  nativeRunRedispatched: false,
  cliFootage: false,
  quarantined: true,
  frameReviewComplete: false,
};
await writeFile(
  resolve(root, `.verification/browser-${id}.json`),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify(manifest, null, 2));
