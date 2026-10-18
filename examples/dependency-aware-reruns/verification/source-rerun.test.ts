import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { signExecutionReceipt, verifyExecutionReceipt, type ExecutionIdentity } from "../../../packages/cloudflare/src/execution-receipt.ts";

// This owned fixture has a closed, deliberately small input contract. It is not
// automatic dependency discovery or an arbitrary-project input-closure verifier.
const fixture = "examples/dependency-aware-reruns/verification/fixture";
const driver = "examples/dependency-aware-reruns/verification/source-rerun.test.ts";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const blob = (revision: string, path: string) => execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8" });
const manifest = (path: string) => hash(JSON.stringify(readdirSync(path).sort().map(name => {
  assert.ok(!name.includes("/") && !name.startsWith("."));
  return [name, hash(readFileSync(join(path, name)))];
})));
type Leaf = "left" | "right";
type Snapshot = { path: string; digest: string };

test("real source changes select only affected work and restore owned filesystem checkpoints", async () => {
  const remote = git("remote", "get-url", "origin").replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "");
  assert.match(remote, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  const pinned = JSON.parse(readFileSync("examples/dependency-aware-reruns/verification/source-revisions.json", "utf8")) as { original: string; changed: string };
  assert.equal(Object.keys(pinned).sort().join(), "changed,original");
  const revisions = [pinned.changed, pinned.original];
  for (const revision of revisions) {
    assert.match(revision, /^[a-f0-9]{40}$/);
    try { git("cat-file", "-e", `${revision}^{commit}`); }
    catch { git("fetch", "--no-tags", "origin", revision); }
  }
  const [changedRevision, originalRevision] = revisions as [string, string];
  // Source commits contain the fixture program/data. The trusted host/SDK runs
  // at the current checkout, independently of the project source revision.
  git("diff", "--exit-code", "HEAD", "--", "packages/ci/src", "pnpm-lock.yaml", "package.json", driver);
  const hostPolicy = git("ls-tree", "-r", "HEAD", "packages/ci/src", "pnpm-lock.yaml", "package.json", driver);
  const runtimeDigest = hash(Buffer.concat([readFileSync(process.execPath), Buffer.from(JSON.stringify(process.versions))]));
  const policy = (revision: string) => hash(JSON.stringify([hostPolicy, git("ls-tree", "-r", revision, `${fixture}/task.mjs`)]));
  const inputs = (revision: string) => Object.fromEntries((["left", "right"] as const).map(name =>
    [name, hash(blob(revision, `${fixture}/${name}.txt`))])) as Record<Leaf, string>;
  const identity = (revision: string): ExecutionIdentity => ({
    issuer: "https://github.com", repository: remote, revision, workflowId: "source-projection-fixture",
    policyDigest: policy(revision), runtimeDigest, inputsDigest: hash(JSON.stringify(inputs(revision))),
    eventDigest: hash(JSON.stringify({ type: "push", repository: remote, revision })),
  });
  assert.notEqual(inputs(originalRevision).left, inputs(changedRevision).left);
  assert.equal(inputs(originalRevision).right, inputs(changedRevision).right);
  assert.equal(policy(originalRevision), policy(changedRevision), "Only fixture data changes between the two source commits");

  const root = mkdtempSync(join(tmpdir(), "effect-ci-source-lineage-"));
  const snapshots = new Map<string, Snapshot>();
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  const trust = new Map([["fixture", keys.publicKey]]);
  const traces: Array<{ run: string; revision: string; executed: string[]; reused: string[]; reasons: Record<string, string>; output: string; receipt: string }> = [];
  type Previous = { attempt: CI.WorkflowAttempt; identity: ExecutionIdentity; receipt: string };

  const available = (workspace: unknown) => {
    if (!(workspace instanceof CI.Workspace) || workspace.revision?.provider !== "owned-fixture-files") return false;
    const value = workspace.revision.value as { id?: string; digest?: string };
    const snapshot = value && typeof value.id === "string" ? snapshots.get(value.id) : undefined;
    return !!snapshot && existsSync(snapshot.path) && snapshot.digest === value.digest && manifest(snapshot.path) === snapshot.digest;
  };

  async function execute(run: string, revision: string, previous?: Previous): Promise<Previous> {
    const currentIdentity = identity(revision), currentInputs = inputs(revision);
    const reasons: Record<string, string> = {};
    let selected: string[] = [];
    if (previous) {
      assert.ok(await verifyExecutionReceipt(previous.receipt, identity(previous.identity.revision), trust));
      for (const name of ["left", "right"] as const) {
        const reason = previous.identity.policyDigest !== currentIdentity.policyDigest ? "policy changed"
          : previous.identity.runtimeDigest !== currentIdentity.runtimeDigest ? "runtime changed"
          : inputs(previous.identity.revision)[name] !== currentInputs[name] ? "input changed"
          : !available(previous.attempt.outputs[name]) ? "checkpoint unavailable or changed" : "same inputs and available checkpoint";
        reasons[name] = reason;
        if (reason !== "same inputs and available checkpoint") selected.push(name);
      }
    } else reasons.left = reasons.right = "first execution";
    const executed: string[] = [], runRoot = join(root, run);
    const stages = new Map<string, string>();
    const stage = (step: string, files: Record<string, string>) => {
      const path = mkdtempSync(join(root, `${run}-${step}-`));
      for (const [name, text] of Object.entries(files)) writeFileSync(join(path, name), text);
      writeFileSync(join(path, "task.mjs"), blob(revision, `${fixture}/task.mjs`));
      stages.set(`/workspace/${step}`, path);
      return CI.Workspace.remote(run, `/workspace/${step}`);
    };
    const local = (workspace: CI.Workspace) => {
      if (!workspace.revision) {
        assert.equal(workspace.id, run);
        assert.ok(stages.has(workspace.cwd));
        return stages.get(workspace.cwd)!;
      }
      assert.ok(available(workspace), "Never read a stale or unavailable checkpoint");
      const value = workspace.revision.value as { id: string };
      const destination = join(runRoot, value.id);
      // The receiving run owns a fresh materialization, never the producer path.
      if (!existsSync(destination)) cpSync(snapshots.get(value.id)!.path, destination, { recursive: true });
      return destination;
    };
    const leaf = (name: Leaf) => CI.action(name, () => function* () {
      const workspace = stage(name, { "input.txt": blob(revision, `${fixture}/${name}.txt`) });
      return yield* workspace.exec("node task.mjs leaf");
    });
    const left = leaf("left"), right = leaf("right");
    const bundle = CI.action("bundle", function* () {
      const a = yield* left(), b = yield* right();
      return function* () {
        const workspace = stage("bundle", { "left.txt": (yield* a.readFile("output.txt"))!, "right.txt": (yield* b.readFile("output.txt"))! });
        return yield* workspace.exec("node task.mjs bundle");
      };
    });
    const workflow = CI.workflow(currentIdentity.workflowId, () => bundle());
    const result = await CI.runPromise(workflow, {
      output: "silent", ci: true,
      event: { type: "push", revision, source: { kind: "git", repository: remote, revision } },
      ...(previous ? { rerun: { previous: previous.attempt, steps: selected } } : {}),
      executor: { execute: ({ workspace, stepId, command }) => Effect.sync(() => {
        assert.ok(["node task.mjs leaf", "node task.mjs bundle"].includes(command));
        executed.push(stepId);
        const stdout = execFileSync(process.execPath, ["task.mjs", stepId === "bundle" ? "bundle" : "leaf"], {
          cwd: local(workspace), env: { PATH: dirname(process.execPath), HOME: root }, encoding: "utf8", timeout: 10000,
        });
        return { exitCode: 0, stdout, stderr: "" };
      }) },
      workspaceFileSystem: {
        exists: (workspace, path) => Effect.sync(() => existsSync(join(local(workspace), path))),
        readFile: (workspace, path) => Effect.sync(() => readFileSync(join(local(workspace), path), "utf8")),
      },
      workspacePersistence: {
        commit: ({ workspace }) => Effect.sync(() => {
          const id = randomUUID(), path = join(root, `snapshot-${id}`);
          cpSync(local(workspace), path, { recursive: true });
          const digest = manifest(path);
          snapshots.set(id, { path, digest });
          return workspace.withRevision({ provider: "owned-fixture-files", value: { id, digest } });
        }),
        checkpoint: () => Effect.die("This fixture uses automatic action commits"),
        restore: () => Effect.die("Rerun reads materialize the validated owned action revision"),
      },
    });
    const receipt = JSON.stringify(await signExecutionReceipt({ keyId: "fixture", key: keys.privateKey,
      identity: currentIdentity, instanceId: run, attempt: result.attempt }));
    assert.ok(await verifyExecutionReceipt(receipt, currentIdentity, trust));
    const output = readFileSync(join(local(result.value), "output.txt"), "utf8");
    const reused = result.plan.nodes.filter(node => node.status === "reused").map(node => node.id);
    traces.push({ run, revision, executed, reused, reasons, output, receipt });
    return { attempt: result.attempt, identity: currentIdentity, receipt };
  }

  try {
    const first = await execute("original", originalRevision);
    const retained = JSON.stringify(first.attempt);
    const second = await execute("changed-input", changedRevision, first);
    assert.deepEqual(traces[1]!.executed, ["left", "bundle"]);
    assert.deepEqual(traces[1]!.reused, ["right"]);
    assert.equal(JSON.stringify(first.attempt), retained);
    assert.deepEqual(second.attempt.outputs.right, first.attempt.outputs.right);
    assert.notEqual(traces[1]!.output, traces[0]!.output);
    assert.equal(traces[1]!.output, `${blob(changedRevision, `${fixture}/left.txt`).trim().toUpperCase()} / BRAVO\n`);
    const originalRight = first.attempt.outputs.right as CI.Workspace;
    const rightId = (originalRight.revision!.value as { id: string }).id;
    rmSync(snapshots.get(rightId)!.path, { recursive: true });
    const third = await execute("expired-checkpoint", changedRevision, second);
    assert.deepEqual(traces[2]!.executed, ["right", "bundle"]);
    assert.deepEqual(traces[2]!.reused, ["left"]);
    assert.equal(traces[2]!.output, traces[1]!.output);
    assert.equal(await verifyExecutionReceipt(first.receipt, identity(changedRevision), trust), undefined);
    assert.equal(await verifyExecutionReceipt(third.receipt, { ...third.identity, policyDigest: "0".repeat(64) }, trust), undefined);
    assert.equal(await verifyExecutionReceipt(third.receipt, { ...third.identity, runtimeDigest: "0".repeat(64) }, trust), undefined);
    assert.equal(await verifyExecutionReceipt(third.receipt, third.identity, new Map()), undefined);
    console.log(JSON.stringify({ proof: "owned-source-rerun-fixture", environment: process.env.GITHUB_ACTIONS ? "GitHub Actions" : "local",
      repository: remote, revisions, runtimeDigest, publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey), traces,
      boundary: "Real Git commits, Node commands and owned filesystem checkpoints; ephemeral fixture issuer, not a deployed generic signer or Cloudflare snapshot proof" }));
  } finally {
    rmSync(root, { recursive: true });
  }
});
