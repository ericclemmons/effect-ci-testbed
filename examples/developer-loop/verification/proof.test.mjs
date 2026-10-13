import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyReport, verifyVideo } from "./proof.mjs";

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
