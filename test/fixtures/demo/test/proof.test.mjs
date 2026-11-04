import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyReport, verifyVideo } from "./proof.mjs";
import { validatePage, renderPage, createPreview } from "./page.mjs";

const report = (negative = false) => {
  const status = negative ? "failed" : "passed";
  return {
    status,
    exitCode: negative ? 1 : 0,
    startedAt: "2026-10-13T00:00:00Z",
    finishedAt: "2026-10-13T00:00:10Z",
    results: [
      {
        status,
        selected: true,
        kind: "test",
        attempts: [
          {
            status,
            cleanup: "complete",
            secondaryErrors: [],
            error: negative ? { code: "ASSERTION_FAILED" } : undefined,
            steps: [
              { kind: "app", status: "passed" },
              { kind: "assertion", api: "expect.toHaveText", status },
            ],
            artifacts: [
              { kind: "video", mediaType: "video/webm", startedAt: "2026-10-13T00:00:01Z" },
            ],
          },
        ],
      },
    ],
  };
};

test("passed and expected failed observations retain their actual outcome", () => {
  assert.equal(verifyReport(report(), false).kind, "video");
  assert.equal(verifyReport(report(true), true).kind, "video");
  assert.throws(() => verifyReport(report(true), false));
  assert.throws(() => verifyReport(report(), true));
  const unselected = report();
  unselected.results.push({ selected: false, kind: "test", status: "skipped", attempts: [] });
  assert.equal(verifyReport(unselected, false).kind, "video");
});

const pageFixture = (negative = false) => {
  const run = report(negative);
  run.id = "11111111-2222-3333-4444-555555555555";
  run.runner = { name: "e2e", version: "0.19" };
  run.targets = [{ id: "web", engine: { name: "web", version: "0.14" } }];
  run.results[0].targetId = "web";
  run.results[0].attempts[0].environment = { browser: "chromium" };
  const video = run.results[0].attempts[0].artifacts[0];
  Object.assign(video, {
    path: "test/attempt-1/video/video.webm",
    size: 1200,
    sha256: "a".repeat(64),
    redaction: "incomplete",
  });
  const captureId = `${negative ? "negative" : "positive"}-11111111-2222-3333-4444-555555555555`;
  return {
    run,
    manifest: {
      schemaVersion: 1,
      recipe: "developer-loop",
      environment: "Effect CI Local",
      sourceRevision: "b".repeat(40),
      repository: "https://github.com/owner/repo",
      captureId,
      runId: run.id,
      scenario: negative ? "intentional wrong expectation" : "build then browser interaction",
      command: "effect-ci run build --format=json",
      actual: run.status,
      expected: run.status,
      signedAttestation: false,
      video: {
        path: `.e2e/${captureId}/results/${video.path}`,
        bytes: video.size,
        sha256: video.sha256,
        redaction: video.redaction,
      },
      startedAt: "2026-10-12T23:59:59Z",
      buildFinishedAt: run.startedAt,
      browserStartedAt: run.startedAt,
      finishedAt: run.finishedAt,
      buildElapsedMs: 1000,
      browserElapsedMs: 10000,
      queueElapsedMs: null,
      decisionWaitMs: null,
      planMermaid: "flowchart LR\n  checkout --> build",
      browser: "chromium",
      runtime: "v26",
      platform: "darwin",
      architecture: "arm64",
      runner: { name: "e2e", version: "0.19" },
      engine: { name: "web", version: "0.14" },
      conditions: { dependenciesPresent: true, artifactPresent: false },
    },
  };
};

test("review pages preserve failure, actual command plan and unknown timings", () => {
  for (const negative of [false, true]) {
    const { manifest, run } = pageFixture(negative);
    validatePage(manifest, run);
    validatePage({ ...manifest, recipe: "demo" }, run);
    assert.throws(() => validatePage({ ...manifest, recipe: "unrelated" }, run));
    const page = renderPage(manifest, "trace.md");
    assert.match(page, /quarantined local preview/);
    assert.match(page, /Unknown \/ unknown/);
    assert.match(page, /checkout --> build/);
    assert.match(
      page,
      negative
        ? /actual browser outcome: \*\*failed\*\*/
        : /actual browser outcome: \*\*passed\*\*/,
    );
    assert.match(page, /Not independently measured/);
  }
});

test("mismatched metadata, timing, claims and markdown injection cannot enter review pages", () => {
  for (const change of [
    { runId: "../report" },
    { sourceRevision: "main" },
    { repository: "https://user:secret@github.com/o/r" },
    { actual: "passed", expected: "passed" },
    { browserElapsedMs: 1 },
    { queueElapsedMs: 0 },
    { signedAttestation: true },
    { planMermaid: "flowchart LR\n```\n<script>" },
    { video: { path: "../escape", bytes: 1200, sha256: "a".repeat(64) } },
  ]) {
    const { manifest, run } = pageFixture(true);
    assert.throws(() => validatePage({ ...manifest, ...change }, run));
  }
  assert.throws(() => createPreview("/tmp", "../../../../examples/escape"));
});

test("review output is create-only and rechecks retained media before writing", () => {
  const root = mkdtempSync(join(tmpdir(), "recipe-preview-"));
  try {
    const { manifest, run } = pageFixture(true);
    // Metadata fixture, not video playback evidence.
    const bytes = new Uint8Array(1200).fill(1);
    const digest = createHash("sha256").update(bytes).digest("hex");
    manifest.video.sha256 = digest;
    run.results[0].attempts[0].artifacts[0].sha256 = digest;
    mkdirSync(join(root, ".verification"));
    const capture = join(root, ".e2e", manifest.captureId);
    mkdirSync(join(capture, "results/test/attempt-1/video"), { recursive: true });
    writeFileSync(join(root, ".verification", `${run.id}.json`), JSON.stringify(manifest));
    writeFileSync(join(capture, "report.json"), JSON.stringify({ run }));
    writeFileSync(join(capture, "results/test/trace.md"), "Actual failed assertion");
    writeFileSync(join(root, manifest.video.path), bytes);
    const output = createPreview(root, run.id);
    const original = readFileSync(output, "utf8");
    assert.match(original, /actual browser outcome: \*\*failed\*\*/);
    assert.throws(() => createPreview(root, run.id), /EEXIST/);
    writeFileSync(join(root, manifest.video.path), new Uint8Array(1200).fill(2));
    assert.throws(() => createPreview(root, run.id), /digest mismatch/);
    assert.equal(readFileSync(output, "utf8"), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("engine failures, incomplete cleanup and missing assertions cannot satisfy a negative test", () => {
  const engine = report(true);
  engine.results[0].attempts[0].error.code = "ENGINE_FAILURE";
  assert.throws(() => verifyReport(engine, true));
  const cleanup = report();
  cleanup.results[0].attempts[0].cleanup = "incomplete";
  assert.throws(() => verifyReport(cleanup, false));
  const noAssertion = report();
  noAssertion.results[0].attempts[0].steps = [{ kind: "app", status: "passed" }];
  assert.throws(() => verifyReport(noAssertion, false));
});

test("missing media and out-of-window video timestamps fail closed", () => {
  const missing = report();
  missing.results[0].attempts[0].artifacts = [];
  assert.throws(() => verifyReport(missing, false));
  const late = report();
  late.results[0].attempts[0].artifacts[0].startedAt = "2026-10-14T00:00:00Z";
  assert.throws(() => verifyReport(late, false));
});

test("media paths, digests and byte counts are validated independently of report labels", () => {
  const root = mkdtempSync(join(tmpdir(), "recipe-proof-"));
  const outside = mkdtempSync(join(tmpdir(), "recipe-proof-outside-"));
  try {
    // Metadata-unit fixture, deliberately NOT a playable-video proof.
    const bytes = new Uint8Array(1200).fill(1);
    const file = join(root, "video.webm");
    writeFileSync(file, bytes);
    const video = {
      path: "video.webm",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    assert.equal(verifyVideo(root, video).bytes, 1200);
    assert.throws(() => verifyVideo(root, { ...video, sha256: "bad" }));
    assert.throws(() => verifyVideo(root, { ...video, size: 1 }));
    assert.throws(() => verifyVideo(root, { ...video, path: "../outside" }));
    writeFileSync(join(outside, "video.webm"), bytes);
    symlinkSync(join(outside, "video.webm"), join(root, "escape.webm"));
    assert.throws(() => verifyVideo(root, { ...video, path: "escape.webm" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
