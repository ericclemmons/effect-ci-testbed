// Explicit bookkeeping for the conventional Actions comparison. No Effect CI
// executor, signatures, shared cache service or project-supplied prior state.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const fixture = "examples/dependency-aware-reruns/verification/fixture";
const pins = JSON.parse(readFileSync(new URL("./source-revisions.json", import.meta.url), "utf8"));
const names = ["left", "right", "bundle"];
const hash = value => createHash("sha256").update(value).digest("hex");
const blob = (revision, path) => execFileSync("git", ["show", `${revision}:${fixture}/${path}`], { encoding: "utf8" });
const runtime = flags => hash(Buffer.concat([readFileSync(process.execPath), Buffer.from(JSON.stringify([process.versions, flags]))]));
const read = root => JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
const save = (root, state) => writeFileSync(join(root, "state.json"), JSON.stringify(state));

function execute(root, name, revision, flags) {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "task.mjs"), blob(revision, "task.mjs"));
  if (name === "bundle") {
    for (const leaf of ["left", "right"]) writeFileSync(join(path, `${leaf}.txt`), readFileSync(join(root, leaf, "output.txt")));
  } else writeFileSync(join(path, "input.txt"), blob(revision, `${name}.txt`));
  execFileSync(process.execPath, [...flags, "task.mjs", name === "bundle" ? "bundle" : "leaf"], {
    cwd: path, env: { PATH: dirname(process.execPath), HOME: root }, timeout: 10000,
  });
  return hash(readFileSync(join(path, "output.txt")));
}

const [operation, argument] = process.argv.slice(2);
if (operation === "prepare") {
  assert.ok(["input", "unchanged", "missing", "tampered", "program", "runtime"].includes(argument));
  for (const revision of [pins.original, pins.changed, pins.programChanged]) {
    assert.match(revision, /^[a-f0-9]{40}$/);
    try { execFileSync("git", ["cat-file", "-e", `${revision}^{commit}`], { stdio: "ignore" }); }
    catch {
      assert.match(pins.repository, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
      execFileSync("git", ["-c", "credential.helper=", "-c", "http.extraheader=", "-c", "http.https://github.com/.extraheader=", "fetch", "--no-tags", pins.repository, revision], { timeout: 30000 });
    }
  }
  const root = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "effect-ci-conventional-"));
  const original = argument === "input" ? pins.original : pins.changed;
  const revision = argument === "program" ? pins.programChanged : pins.changed;
  const flags = argument === "runtime" ? ["--jitless", "--no-warnings"] : [];
  const previous = Object.fromEntries(names.map(name => [name, { producer: "original", digest: execute(root, name, original, []) }]));
  if (argument === "missing") rmSync(join(root, "right", "output.txt"));
  if (argument === "tampered") writeFileSync(join(root, "bundle", "output.txt"), "tampered\n");
  const reasons = {}, selected = {};
  for (const name of names) {
    const output = join(root, name, "output.txt");
    const reason = hash(blob(original, "task.mjs")) !== hash(blob(revision, "task.mjs")) ? "program changed"
      : runtime([]) !== runtime(flags) ? "runtime changed"
      : name === "bundle" && (selected.left || selected.right) ? "dependency affected"
      : name !== "bundle" && blob(original, `${name}.txt`) !== blob(revision, `${name}.txt`) ? "input changed"
      : !existsSync(output) || hash(readFileSync(output)) !== previous[name].digest ? "checkpoint unavailable or changed"
      : "same inputs and available checkpoint";
    reasons[name] = reason;
    selected[name] = reason !== "same inputs and available checkpoint";
  }
  save(root, { scenario: argument, original, revision, flags, previous, selected, reasons, executed: [], lineage: previous });
  assert.ok(process.env.GITHUB_OUTPUT, "The caller supplies a private Actions output file");
  appendFileSync(process.env.GITHUB_OUTPUT, `root=${root}\n${names.map(name => `${name}=${selected[name]}`).join("\n")}\n`);
} else {
  const root = process.env.COMPARISON_ROOT;
  assert.ok(root, "Use the root returned by prepare on this runner");
  const state = read(root);
  if (operation === "run") {
    assert.ok(names.includes(argument) && state.selected[argument], "Only explicitly selected steps may execute");
    assert.ok(!state.executed.includes(argument), "A selected step executes once");
    state.lineage[argument] = { producer: "receiving-run", digest: execute(root, argument, state.revision, state.flags) };
    state.executed.push(argument);
    save(root, state);
  } else {
    assert.equal(operation, "verify");
    const expected = { input: ["left", "bundle"], unchanged: [], missing: ["right", "bundle"], tampered: ["bundle"], program: names, runtime: names }[state.scenario];
    assert.deepEqual(state.executed, expected);
    assert.deepEqual(names.filter(name => state.selected[name]), expected);
    for (const name of names.filter(name => !state.selected[name])) assert.deepEqual(state.lineage[name], state.previous[name]);
    const fresh = mkdtempSync(join(tmpdir(), "effect-ci-conventional-full-"));
    try {
      for (const name of names) {
        const digest = execute(fresh, name, state.revision, state.flags);
        assert.equal(hash(readFileSync(join(root, name, "output.txt"))), digest);
      }
      console.log(JSON.stringify({ proof: "conventional-source-rerun", environment: process.env.GITHUB_ACTIONS === "true" ? "GitHub Actions" : "local",
        scenario: state.scenario, revision: state.revision, executed: state.executed,
        reused: names.filter(name => !state.selected[name]), reasons: state.reasons, lineage: state.lineage,
        output: readFileSync(join(root, "bundle", "output.txt"), "utf8"), fullComparison: true,
        boundary: "Explicit YAML conditions and runner-local files; no signed reuse or Cloudflare snapshot claim" }));
    } finally { rmSync(fresh, { recursive: true }); }
  }
}
