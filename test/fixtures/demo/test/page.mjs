import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { verifyReport, verifyVideo } from "./proof.mjs";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const text = (value) => String(value).replace(/[&<>`[\]\\*_|\r\n]/g, " ");

export function validatePage(manifest, run) {
  const negative = manifest.scenario === "intentional wrong expectation";
  const video = verifyReport(run, negative);
  const result = run.results.find((item) => item.selected && item.kind === "test");
  const engine = run.targets?.find((target) => target.id === result.targetId)?.engine;
  const times = ["startedAt", "buildFinishedAt", "browserStartedAt", "finishedAt"].map((key) =>
    Date.parse(manifest[key]),
  );
  if (
    manifest.schemaVersion !== 1 ||
    !["demo", "developer-loop"].includes(manifest.recipe) ||
    manifest.environment !== "Effect CI Local" ||
    !uuid.test(manifest.runId) ||
    manifest.runId !== run.id ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceRevision) ||
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(manifest.repository) ||
    !new RegExp(`^${negative ? "negative" : "positive"}-[0-9a-f-]{36}$`).test(manifest.captureId) ||
    (!negative && manifest.scenario !== "build then browser interaction") ||
    manifest.command !== "effect-ci run build --format=json" ||
    manifest.actual !== run.status ||
    manifest.expected !== (negative ? "failed" : "passed") ||
    manifest.signedAttestation !== false ||
    manifest.runner?.name !== run.runner?.name ||
    manifest.runner?.version !== run.runner?.version ||
    manifest.engine?.name !== engine?.name ||
    manifest.engine?.version !== engine?.version ||
    manifest.browser !== result.attempts[0].environment?.browser ||
    manifest.video.path !== `.e2e/${manifest.captureId}/results/${video.path}` ||
    manifest.video.sha256 !== video.sha256 ||
    manifest.video.bytes !== video.size ||
    manifest.video.redaction !== video.redaction ||
    times.some((time, i) => !Number.isFinite(time) || (i > 0 && time < times[i - 1])) ||
    manifest.buildElapsedMs !== times[1] - times[0] ||
    manifest.browserElapsedMs !== times[3] - times[2] ||
    Date.parse(run.startedAt) < times[2] ||
    Date.parse(run.finishedAt) > times[3] ||
    manifest.queueElapsedMs !== null ||
    manifest.decisionWaitMs !== null ||
    typeof manifest.planMermaid !== "string" ||
    manifest.planMermaid.length > 16_384 ||
    typeof manifest.conditions?.dependenciesPresent !== "boolean" ||
    typeof manifest.conditions?.artifactPresent !== "boolean" ||
    !manifest.planMermaid.startsWith("flowchart LR\n") ||
    /[`<\r]|%%|click\s/.test(manifest.planMermaid)
  )
    throw new Error("Manifest does not match the recorded local observation");
  return video;
}

export function renderPage(manifest, tracePath) {
  const negative = manifest.actual === "failed";
  return `# Local verification review — ${negative ? "expected assertion failure" : "passed"}

This is a **quarantined local preview**, not a published README proof or signed attestation.
Review the entire video and transcript for private data, and verify playback before publication.
No hosted result, cache hit, or benchmark is implied.

- Source: [${manifest.sourceRevision.slice(0, 7)}](${manifest.repository}/commit/${manifest.sourceRevision})
- Run: ${manifest.runId} · Effect CI Local · ${text(manifest.scenario)}
- Expected: ${manifest.expected}; actual browser outcome: **${manifest.actual}**${negative ? " (the negative-test wrapper accepts this failure, not a passing application test)" : ""}
- Command: \`${manifest.command}\`
- Browser: ${text(manifest.browser)} · ${text(manifest.runtime)} / ${text(manifest.platform)} / ${text(manifest.architecture)}
- Recorder: ${text(manifest.runner.name)} ${text(manifest.runner.version)}; engine ${text(manifest.engine.name)} ${text(manifest.engine.version)}

## Generated plan for this command

\`\`\`mermaid
${manifest.planMermaid}
\`\`\`

## Same-run evidence

[Video](../${manifest.video.path}) · [Assertion transcript](../${tracePath}) · [Manifest](./${manifest.runId}.json)

Video SHA256: \`${manifest.video.sha256}\` (${manifest.video.bytes} bytes).
Framework redaction status: ${text(manifest.video.redaction)}. This preview does not certify redaction or media decoding.

## One observed sample

| Measurement | Value |
| --- | --- |
| Local build process | ${manifest.buildElapsedMs} ms |
| Browser process, including launch/cleanup | ${manifest.browserElapsedMs} ms |
| End-to-end recorder window | ${Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)} ms |
| Queue / decision wait | Unknown / unknown |
| Dependencies / prior build artifact present | ${manifest.conditions.dependenciesPresent} / ${manifest.conditions.artifactPresent} |
| Cache hit | Not independently measured |

Observed ${manifest.startedAt}–${manifest.finishedAt}. Raw footage is unedited; no speed changes.
Unsigned metadata is explanatory evidence only, never authorization to skip checks.
`;
}

const containedFile = (root, relative) => {
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep) || !realpathSync(path).startsWith(realpathSync(root) + sep))
    throw new Error("Evidence path escapes the recipe");
  return path;
};

export function createPreview(rootPath, runId) {
  if (!uuid.test(runId)) throw new Error("Pass one recorded run UUID, not a path");
  const root = realpathSync(rootPath);
  const manifest = JSON.parse(
    readFileSync(containedFile(root, `.verification/${runId}.json`), "utf8"),
  );
  // Validate before using captureId as a file path.
  if (!/^(positive|negative)-[0-9a-f-]{36}$/.test(manifest.captureId))
    throw new Error("Invalid capture identity");
  const report = JSON.parse(
    readFileSync(containedFile(root, `.e2e/${manifest.captureId}/report.json`), "utf8"),
  );
  const video = validatePage(manifest, report.run);
  const results = containedFile(root, `.e2e/${manifest.captureId}/results`);
  verifyVideo(results, video);
  if (!/^[\w./-]+$/.test(video.path)) throw new Error("Invalid link path");
  const tracePath = `.e2e/${manifest.captureId}/results/${video.path.split("/")[0]}/trace.md`;
  containedFile(root, tracePath);
  const output = resolve(root, `.verification/${runId}.md`);
  writeFileSync(output, renderPage(manifest, tracePath), { flag: "wx" });
  return output;
}
