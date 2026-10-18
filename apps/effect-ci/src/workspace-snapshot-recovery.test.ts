import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { makeCommandStepExecutor } from "../../../packages/cloudflare/src/command-step.ts";

// Exercise the actual provider class. Only the platform container/storage are
// simulated: Node cannot construct a Cloudflare Container or force its failure.
const require = createRequire(import.meta.url);
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
const compiled = await build({
  stdin: {
    resolveDir: new URL(".", import.meta.url).pathname,
    contents: 'export { WorkspaceContainer, makeRunner } from "@effect-ci-testbed/cloudflare"; export { runPromise, gen } from "effect/Effect"; export { Workspace } from "@effect-ci-testbed/ci";',
    loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "node", target: "esnext",
  plugins: [{ name: "platform-fixture", setup(b: any) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }
      export class WorkerEntrypoint extends DurableObject {}
      export class WorkflowEntrypoint extends DurableObject {}
    ` }));
  } }],
});
const { WorkspaceContainer, makeRunner, runPromise, gen, Workspace } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const revision = { id: "checkout", name: "checkout-workspace", size: 1 };

function fixture() {
  const stored = new Map<string, any>([["activeCheckpoint", revision]]);
  const snapshots = new Map<string, string[]>([["checkout", ["package.json"]]]);
  let files = ["package.json"], captures = 0, starts = 0, commands = 0;
  let failSnapshot: "none" | "running" | "stopped" = "none", failRelease = false, failStorageAck = false;
  const container = {
    running: true, images: {},
    start(options: any) { starts++; const saved = snapshots.get(options.containerSnapshot.id); if (!saved) throw Error("Ancestor snapshot unavailable"); files = [...saved]; this.running = true; },
    async destroy() { this.running = false; if (failRelease) { failRelease = false; throw Error("Lost release acknowledgement"); } },
    async snapshotContainer({ name }: any) {
      captures++;
      if (failSnapshot !== "none") {
        if (failSnapshot === "stopped") this.running = false;
        failSnapshot = "none";
        throw Error("The container snapshot could not be completed due to an internal error");
      }
      const snapshot = { id: "snapshot-" + captures, name, size: files.length };
      snapshots.set(snapshot.id, [...files]); return snapshot;
    },
    async exec(command: string[]) {
      let exitCode = 0, stdout = new Uint8Array();
      if (command[0] === "sh") { commands++; files.push("node_modules/.bin/vpr"); }
      else if (command[0] === "test") exitCode = command.at(-1) === "." || files.includes(command.at(-1)!) ? 0 : 1;
      else if (command[0] === "cat") stdout = new TextEncoder().encode(files.at(-1)!);
      return { output: async () => ({ exitCode, stdout, stderr: new Uint8Array() }) };
    },
  };
  const ctx = { container, storage: {
    get: async (key: string) => stored.get(key),
    put: async (key: string | Record<string, any>, value: any) => {
      if (typeof key === "string") stored.set(key, structuredClone(value));
      else {
        for (const [k, v] of Object.entries(key)) stored.set(k, structuredClone(v));
        if (failStorageAck && key["committed:install-workspace"]) { failStorageAck = false; throw Error("Lost storage acknowledgement"); }
      }
    },
  } };
  let workspace = new WorkspaceContainer(ctx, {});
  const commit = (release = false) => workspace.checkpoint("install-workspace", release,
    { cwd: "/workspace/repository", stepId: "install", revision });
  return {
    install: () => workspace.execute("npm ci", "/workspace/repository", "install", revision),
    commit, restart: () => { workspace = new WorkspaceContainer(ctx, {}); },
    fail: (mode: typeof failSnapshot) => { failSnapshot = mode; },
    releaseFailure: () => { failRelease = true; },
    storageFailure: () => { failStorageAck = true; },
    stop: () => { container.running = false; },
    counts: () => ({ captures, starts, commands }),
    contents: (snapshot: any) => snapshots.get(snapshot.id),
    foreignStep: () => workspace.exists(".", "/workspace/repository", "other", revision),
    foreignRevision: () => workspace.exists(".", "/workspace/repository", "install", { ...revision, id: "foreign" }),
    importSource: () => workspace.materializeSource([{ path: "health.js", base64: "MjAw" }]),
    dropAncestor: () => snapshots.delete("checkout"),
    foreignCommit: () => workspace.checkpoint("install-workspace", false,
      { cwd: "/workspace/repository", stepId: "install", revision: { ...revision, id: "foreign" } }),
    addInput: (id: string, text: string) => snapshots.set(id, ["output.txt", text]),
    readInput: (id: string, stepId = "bundle") => workspace.readFile("output.txt", "/workspace/repository", stepId, { id, name: id, size: 2 }),
  };
}

test("one action reads each immutable dependency revision, even when both contain the same path", async () => {
  const f = fixture(); f.addInput("left", "LEFT"); f.addInput("right", "RIGHT");
  assert.equal(await f.readInput("left"), "LEFT");
  assert.equal(await f.readInput("right"), "RIGHT");
  assert.equal(await f.readInput("left"), "LEFT");
  const before = f.counts();
  assert.equal(await f.readInput("left"), "LEFT");
  assert.deepEqual(f.counts(), before, "An unchanged clean input does not restart its container");
  assert.equal(before.starts, 3, "Only actual revision changes materialize another input");
});

test("different actions already read distinct snapshots with the same file path", async () => {
  const f = fixture(); f.addInput("left", "LEFT"); f.addInput("right", "RIGHT");
  assert.equal(await f.readInput("left", "first"), "LEFT");
  assert.equal(await f.readInput("right", "second"), "RIGHT");
  assert.equal(await f.readInput("left", "first"), "LEFT");
});

test("switching a same-action read cannot discard uncheckpointed command output", async () => {
  const f = fixture(); f.addInput("right", "RIGHT"); await f.install();
  const before = f.counts();
  await assert.rejects(f.readInput("right", "install"), /uncheckpointed/i);
  assert.deepEqual(f.counts(), before);
  assert.ok(f.contents(await f.commit())?.includes("node_modules/.bin/vpr"));
});

test("granular file checkpoints distinguish input, path and repeated observations without rewriting replay", async () => {
  const receipts = new Map<string, unknown>(), calls: string[] = [];
  let version = 1;
  const provider = {
    async readFile(path: string, cwd: string, _step: string, revision: { id: string }) {
      calls.push(`read:${revision.id}:${path}`); return `${revision.id}:${cwd}:${path}:${version}`;
    },
    async exists(_path: string, _cwd: string, _step: string, revision: { id: string }) { calls.push(`exists:${revision.id}`); return revision.id === "left"; },
  };
  const step = { do: async (name: string, ...args: any[]) => {
    if (!receipts.has(name)) receipts.set(name, structuredClone(await args.at(-1)({ attempt: 1 })));
    return structuredClone(receipts.get(name));
  } };
  const runner = () => makeRunner({ binding: { getByName: () => provider }, repository: "https://github.com/example/public", revision: "a".repeat(40), workspaceId: "files", step });
  const input = (id: string) => Workspace.remote("files", "/workspace", { provider: "cloudflare-container", value: { id, name: id, size: 1 } });
  const read = (r: any, id: string, path = "output.txt") => runPromise(r.fileSystem.readFile(input(id), path, "bundle"));
  const first = runner();
  assert.equal(await read(first, "left"), "left:/workspace:output.txt:1");
  assert.equal(await read(first, "right"), "right:/workspace:output.txt:1");
  assert.equal(await read(first, "left", "a/b"), "left:/workspace:a/b:1");
  assert.equal(await read(first, "left", "a-b"), "left:/workspace:a-b:1");
  version = 2;
  assert.equal(await read(first, "left"), "left:/workspace:output.txt:2");
  assert.equal(await runPromise(first.fileSystem.exists(input("left"), "output.txt", "bundle")), true);
  assert.equal(await runPromise(first.fileSystem.exists(input("right"), "output.txt", "bundle")), false);
  const before = calls.length, retained = JSON.stringify([...receipts]);
  version = 3;
  const replay = runner();
  assert.equal(await read(replay, "left"), "left:/workspace:output.txt:1");
  assert.equal(await read(replay, "right"), "right:/workspace:output.txt:1");
  assert.equal(await read(replay, "left", "a/b"), "left:/workspace:a/b:1");
  assert.equal(await read(replay, "left", "a-b"), "left:/workspace:a-b:1");
  assert.equal(await read(replay, "left"), "left:/workspace:output.txt:2");
  assert.equal(await runPromise(replay.fileSystem.exists(input("left"), "output.txt", "bundle")), true);
  assert.equal(await runPromise(replay.fileSystem.exists(input("right"), "output.txt", "bundle")), false);
  assert.equal(calls.length, before, "Replay uses each original observation, not one cached path for the whole action");
  assert.equal(JSON.stringify([...receipts]), retained);
});

test("cached whole-action bodies do not shift subsequent granular file ordinals on replay", async () => {
  const receipts = new Map<string, unknown>(); let reads = 0;
  const provider = { async readFile(_path: string, _cwd: string, _step: string, revision: { id: string }) { reads++; return revision.id; } };
  const step = { do: async (name: string, ...args: any[]) => {
    if (!receipts.has(name)) receipts.set(name, structuredClone(await args.at(-1)({ attempt: 1 })));
    return structuredClone(receipts.get(name));
  } };
  const input = (id: string) => Workspace.remote("files", "/workspace", { provider: "cloudflare-container", value: { id, name: id, size: 1 } });
  const execute = async () => {
    const runner = makeRunner({ binding: { getByName: () => provider }, repository: "https://github.com/example/public", revision: "a".repeat(40), workspaceId: "files", step });
    const body = await runPromise(runner.actionExecutor.execute({ stepId: "bundle", options: {}, run: () => gen(function* () {
      const value = yield* runner.fileSystem.readFile(input("left"), "output.txt", "bundle");
      return { value, commands: [], events: [] };
    }) }));
    assert.equal(body.value, "left");
    assert.equal(await runPromise(runner.fileSystem.readFile(input("right"), "output.txt", "bundle")), "right");
  };
  await execute(); assert.equal(reads, 2);
  await execute(); assert.equal(reads, 2, "Both native checkpoints replay without new RPCs");
});

test("a snapshot retry keeps the same still-running install, including after provider-object restart", async () => {
  for (const restart of [false, true]) {
    const f = fixture(); await f.install(); f.fail("running");
    await assert.rejects(f.commit(), /snapshot could not/);
    if (restart) f.restart();
    const saved = await f.commit();
    assert.ok(f.contents(saved)?.includes("node_modules/.bin/vpr"), "retry must capture installed files, not the checkout ancestor");
    assert.equal(f.counts().commands, 1, "snapshot recovery never reruns installation");
  }
});

test("a failed snapshot followed by container loss cannot acknowledge an ancestor as a successful install", async () => {
  for (const restart of [false, true]) {
    const f = fixture(); await f.install(); const starts = f.counts().starts; f.fail("stopped");
    await assert.rejects(f.commit(), /snapshot could not/);
    if (restart) f.restart();
    await assert.rejects(f.commit(), /uncheckpointed|uncommitted/i);
    assert.equal(f.counts().captures, 1);
    assert.equal(f.counts().starts, starts, "lost mutations cannot be replaced with an ancestor");
    assert.equal(f.counts().commands, 1);
  }
});

test("a committed install survives a lost release acknowledgement without recapturing the ancestor", async () => {
  const f = fixture(); await f.install(); f.releaseFailure();
  await assert.rejects(f.commit(true), /release acknowledgement/);
  f.restart(); f.dropAncestor(); const saved = await f.commit(true);
  assert.ok(f.contents(saved)?.includes("node_modules/.bin/vpr"));
  assert.equal(f.counts().captures, 1, "return the existing immutable commit after acknowledgement loss");
  assert.equal(f.counts().commands, 1);
});

test("uncommitted action state cannot be replaced by another step after object restart", async () => {
  const f = fixture(); await f.install(); const starts = f.counts().starts; f.restart();
  await assert.rejects(f.foreignStep(), /uncheckpointed|uncommitted/i);
  assert.equal(f.counts().starts, starts);
  await assert.rejects(f.foreignRevision(), /uncheckpointed|uncommitted/i);
  assert.equal(f.counts().starts, starts);
});

test("a saved snapshot survives a lost storage acknowledgement, not just a lost release acknowledgement", async () => {
  const f = fixture(); await f.install(); f.storageFailure();
  await assert.rejects(f.commit(), /storage acknowledgement/);
  f.restart(); f.dropAncestor(); const saved = await f.commit();
  assert.ok(f.contents(saved)?.includes("node_modules/.bin/vpr"));
  assert.equal(f.counts().captures, 1);
  assert.equal(f.counts().commands, 1);
  await assert.rejects(f.foreignCommit(), /another action or input revision/);
});

test("source materialization also records uncheckpointed changes before a container can disappear", async () => {
  const f = fixture(); await f.importSource(); const starts = f.counts().starts;
  f.stop(); f.restart();
  await assert.rejects(f.foreignStep(), /uncheckpointed/i);
  assert.equal(f.counts().starts, starts);
});

// Only the native step journal and container are simulated here. These tests
// exercise the real command adapter plus the real WorkspaceContainer guard;
// they are not hosted native Workflow or real container-loss evidence.
function commandJournal() {
  const receipts = new Map<string, unknown>(), names: string[] = [];
  const step = { do: async (name: string, ...args: any[]) => {
    names.push(name);
    if (!receipts.has(name)) receipts.set(name, structuredClone(await args.at(-1)()));
    return structuredClone(receipts.get(name));
  } };
  const replay = () => {
    const execute = makeCommandStepExecutor(step as any);
    return (body: () => Promise<any>) => execute({
      stepId: "install", command: "npm ci", options: {},
      workspace: { cwd: "/workspace/repository" } as any,
    }, body);
  };
  return { replay, receipts, names };
}

test("replayed granular command receipts cannot publish a filesystem lost before its checkpoint", async () => {
  const f = fixture(), journal = commandJournal();
  const execute = journal.replay();
  await execute(f.install);
  await execute(f.install);
  const saved = JSON.stringify([...journal.receipts]), before = f.counts();
  f.stop(); f.restart();
  const replay = journal.replay();
  // The durable results still exist, but neither result contains the files.
  await replay(() => { throw Error("Never replay an external command merely to recover its output files"); });
  await replay(() => { throw Error("Never replay an external command merely to recover its output files"); });
  await assert.rejects(f.commit(), /uncheckpointed|uncommitted/i);
  assert.deepEqual(f.counts(), before, "No command replay, ancestor restart or snapshot acknowledgement");
  assert.equal(JSON.stringify([...journal.receipts]), saved, "Receipt history is not rewritten by failed publication");
  assert.deepEqual(journal.names, ['command:["install",1]', 'command:["install",2]', 'command:["install",1]', 'command:["install",2]']);
});

test("granular receipt replay preserves a separately published workspace after object restart", async () => {
  const f = fixture(), journal = commandJournal();
  const execute = journal.replay();
  await execute(f.install);
  await execute(f.install);
  const published = await f.commit(), before = f.counts();
  f.stop(); f.restart(); f.dropAncestor();
  const replay = journal.replay();
  await replay(() => { throw Error("The command already completed"); });
  await replay(() => { throw Error("The command already completed"); });
  assert.deepEqual(await f.commit(), published, "Return the immutable publication, not an ancestor or a new capture");
  assert.ok(f.contents(published)?.includes("node_modules/.bin/vpr"));
  assert.deepEqual(f.counts(), before);
  assert.equal(journal.receipts.size, 2);
});
