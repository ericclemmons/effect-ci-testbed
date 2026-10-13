import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { verifyReport, verifyVideo } from "./proof.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const clean = () => {
  if (git("diff", "HEAD") || git("ls-files", "--others", "--exclude-standard", "--", ".")) {
    throw new Error("Commit this recipe before recording exact-commit proof");
  }
};
clean();
for (const name of [".e2e", ".verification"]) {
  const path = resolve(root, name);
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) {
    throw new Error("Recording outputs must be ordinary recipe-owned directories");
  }
}
const sourceRevision = git("rev-parse", "HEAD");
const negative = process.argv.includes("--negative");
if (process.argv.slice(2).some((arg) => arg !== "--negative")) throw new Error("Only --negative is supported");
const conditions = { dependenciesPresent: existsSync(resolve(root, "node_modules")), artifactPresent: existsSync(resolve(root, "dist/message.js")), cacheHit: "not independently measured" };
const cli = fileURLToPath(new URL("../../../packages/cli/src/bin.ts", import.meta.url));
const startedAt = new Date().toISOString();
const result = JSON.parse(execFileSync(process.execPath, [cli, "run", "build", "--format=json"], {
  cwd: root, encoding: "utf8", timeout: 120_000,
}));
const buildFinishedAt = new Date().toISOString();
if (!result.ok || result.plan.nodes.some((node) => node.status !== "complete")) throw new Error("Build incomplete");
clean();
const output = `.e2e/${negative ? "negative" : "positive"}`;
const browserStartedAt = new Date().toISOString();
const browser = spawnSync("e2e", ["run", `verification/${negative ? "negative" : "flow"}.e2e.ts`, "--output", output], {
  cwd: root, encoding: "utf8", timeout: 60_000,
  env: { ...process.env, E2E_TELEMETRY_DISABLED: "1" },
});
const finishedAt = new Date().toISOString();
process.stdout.write(browser.stdout ?? "");
process.stderr.write(browser.stderr ?? "");
if (browser.error || browser.status !== (negative ? 1 : 0)) throw new Error("Unexpected browser process outcome");
const run = JSON.parse(readFileSync(resolve(root, output, "report.json"), "utf8")).run;
const expected = negative ? "failed" : "passed";
const video = verifyReport(run, negative);
const observation = run.results.find((result) => result.selected === true && result.kind === "test");
const media = verifyVideo(resolve(root, output, "results"), video);
clean();
if (git("rev-parse", "HEAD") !== sourceRevision) throw new Error("Source revision changed during verification");
mkdirSync(resolve(root, ".verification"), { recursive: true });
const manifest = {
  schemaVersion: 1, recipe: "developer-loop", environment: "Effect CI Local", sourceRevision,
  scenario: negative ? "intentional wrong expectation" : "build then browser interaction",
  expected, actual: run.status, runId: run.id, startedAt, buildFinishedAt, browserStartedAt, finishedAt,
  buildElapsedMs: Date.parse(buildFinishedAt) - Date.parse(startedAt),
  browserElapsedMs: Date.parse(finishedAt) - Date.parse(browserStartedAt), conditions,
  runner: run.runner, engine: run.targets.find((target) => target.id === observation.targetId).engine,
  browser: observation.attempts[0].environment.browser,
  video: { path: `${output}/results/${video.path}`, ...media, redaction: video.redaction },
  publication: "quarantined local artifact; review before any public publication",
  signedAttestation: false,
};
writeFileSync(resolve(root, ".verification", `${run.id}.json`), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(manifest, null, 2));
