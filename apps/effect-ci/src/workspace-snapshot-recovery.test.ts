import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCommandStepExecutor } from "../../../packages/cloudflare/src/command-step.ts";

// Exercise the actual provider class. Only the platform container/storage are
// simulated: Node cannot construct a Cloudflare Container or force its failure.
const require = createRequire(import.meta.url);
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
const compiled = await build({
  stdin: {
    resolveDir: new URL(".", import.meta.url).pathname,
    contents: 'export { WorkspaceContainer, makeRunner } from "@effect-ci-testbed/cloudflare"; export { runPromise, gen } from "effect/Effect"; export { Workspace, Source, workflow, action, runPromise as runWorkflow } from "@effect-ci-testbed/ci";',
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
const { WorkspaceContainer, makeRunner, runPromise, gen, Workspace, Source, workflow, action, runWorkflow } = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const revision = { id: "checkout", name: "checkout-workspace", size: 1 };

test("the actual workspace executor returns a recorded nonzero result after transport loss without replay or restoring an ancestor", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-ci-captured-workspace-"));
  const boot = join(root, "boot"), effects = join(root, "effects");
  await writeFile(boot, "fixture-boot");
  const stored = new Map<string, unknown>(), boundaries: any[] = [];
  let commands = 0, starts = 0;
  class CapturedWorkspace extends WorkspaceContainer {
    constructor(ctx: any, environment: any) { super(ctx, environment); }
    captureExecutionResult() { return true; }
    executionObserver() { return (event: any) => boundaries.push(event); }
  }
  const container = { running: true,
    start() { starts++; throw Error("Never restore an ancestor for result recovery"); },
    async exec(input: string[], options: { cwd?: string } = {}) {
      const argv = [...input];
      const business = argv.length > 6 && argv[5] === "/proc/sys/kernel/random/boot_id";
      if (argv[5] === "/proc/sys/kernel/random/boot_id") argv[5] = boot;
      if (business) commands++;
      const output = await new Promise<any>((resolve, reject) => {
        const child = spawn(argv[0]!, argv.slice(1), { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        child.stdout.on("data", bytes => stdout.push(bytes)); child.stderr.on("data", bytes => stderr.push(bytes));
        child.on("error", reject);
        child.on("close", exitCode => resolve({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
      });
      return { output: async () => { if (business) throw Error("lost provider exec channels"); return output; } };
    },
  };
  const workspace = new CapturedWorkspace({ container, storage: {
    get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); },
  } }, {});
  try {
    const result = await workspace.execute('printf x >> effects; printf original; printf failure >&2; exit 7', root, "test",
      undefined, [], root, { loginShell: false });
    assert.deepEqual(result, { exitCode: 7, stdout: "original", stderr: "failure" });
    assert.equal(await readFile(effects, "utf8"), "x");
    assert.equal(commands, 1); assert.equal(starts, 0);
    assert.ok(boundaries.some(event => event.phase === "readback" && event.recovered && event.exitCode === 7));
    await assert.rejects(workspace.execute("must not run", root, "another-action"), /another action/);
    assert.equal(commands, 1);
    assert.ok(stored.has("workingMutation"), "recovered result does not pretend that workspace publication already happened");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function fixture() {
  const stored = new Map<string, any>([["activeCheckpoint", revision]]);
  const snapshots = new Map<string, string[]>([["checkout", ["package.json"]]]);
  let files = ["package.json"], captures = 0, starts = 0, commands = 0;
  let failSnapshot: "none" | "running" | "stopped" = "none", failRelease = false, failStorageAck = false;
  let queryResponse: string | undefined;
  let outputResponse: string | undefined;
  let failCommandOutput = false;
  let failReadiness = false, brokenObserver = false;
  const boundaries: any[] = [];
  class ObservedWorkspace extends WorkspaceContainer {
    constructor(ctx: any, environment: any) { super(ctx, environment); }
    executionObserver() { return (event: any) => {
      if (brokenObserver) throw Error("private-observer-failure");
      boundaries.push(structuredClone(event));
    }; }
  }
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
      if (failReadiness && command.at(-1) === "fixed-ready") exitCode = 1;
      if (command[0] === "/usr/bin/python3" && outputResponse !== undefined) {
        stdout = new TextEncoder().encode(outputResponse);
      }
      else if ((command[0] === "sh" || command[0] === "/bin/sh") && command.at(-1)?.includes("git --no-pager diff") && queryResponse !== undefined) {
        stdout = new TextEncoder().encode(queryResponse);
      }
      else if (command[0] === "sh") { commands++; files.push("node_modules/.bin/vpr"); }
      else if (command[0] === "test") exitCode = command.at(-1) === "." || files.includes(command.at(-1)!) ? 0 : 1;
      else if (command[0] === "cat") stdout = new TextEncoder().encode(files.at(-1)!);
      return { exitCode: Promise.resolve(exitCode), output: async () => {
        if (failCommandOutput && command[0] === "sh") throw Error("private-provider-cause-not-for-logs");
        return { exitCode, stdout, stderr: new Uint8Array() };
      } };
    },
  };
  const ctx = { container, blockConcurrencyWhile: (operation: () => Promise<unknown>) => operation(), storage: {
    get: async (key: string) => stored.get(key),
    put: async (key: string | Record<string, any>, value: any) => {
      if (typeof key === "string") stored.set(key, structuredClone(value));
      else {
        for (const [k, v] of Object.entries(key)) stored.set(k, structuredClone(v));
        if (failStorageAck && key["committed:install-workspace"]) { failStorageAck = false; throw Error("Lost storage acknowledgement"); }
      }
    },
  } };
  let workspace = new ObservedWorkspace(ctx, {});
  const commit = (release = false) => workspace.checkpoint("install-workspace", release,
    { cwd: "/workspace/repository", stepId: "install", revision });
  return {
    install: () => workspace.execute("npm ci", "/workspace/repository", "install", revision),
    installWithReadiness: () => workspace.execute("npm ci", "/workspace/repository", "install", revision, [], "/workspace/repository",
      { readyCommand: "fixed-ready", loginShell: false }),
    commit, restart: () => { workspace = new ObservedWorkspace(ctx, {}); },
    failCommandOutput: () => { failCommandOutput = true; },
    failReadiness: () => { failReadiness = true; },
    breakObserver: () => { brokenObserver = true; },
    boundaries: () => boundaries,
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
    sourceQuery: (value: string) => { queryResponse = value; },
    provider: () => workspace,
    outputManifest: (value: unknown) => { outputResponse = JSON.stringify(value); },
    inspect: (id = "checkout") => workspace.inspectOutput({ id, size: 1 }, "/workspace/repository", ["dist/**"]),
    running: () => container.running,
  };
}

test("command boundary evidence distinguishes a successful parent exit from unavailable output without disclosing the cause", async () => {
  const f = fixture();
  f.failCommandOutput();
  await assert.rejects(f.install(), /private-provider-cause-not-for-logs/);
  assert.ok(f.boundaries().some(e => e.scope === "command" && e.phase === "exit" && e.state === "received" && e.exitCode === 0));
  assert.ok(f.boundaries().some(e => e.scope === "command" && e.phase === "output" && e.state === "failed"));
  assert.equal(f.boundaries().some(e => e.scope === "command" && e.phase === "decode"), false);
  assert.ok(!JSON.stringify(f.boundaries()).includes("private-provider"));
  assert.ok(!JSON.stringify(f.boundaries()).includes("npm ci"));
  assert.ok(!JSON.stringify(f.boundaries()).includes("checkout"));
  assert.equal(f.counts().commands, 1, "observing a lost output never re-executes the command");
});

test("a failed restored-container readiness probe is not reported as a started business command", async () => {
  const f = fixture(); f.failReadiness();
  await assert.rejects(f.installWithReadiness(), /Container readiness check failed/);
  assert.ok(f.boundaries().some(e => e.scope === "workspace" && e.phase === "start" && e.state === "received"));
  assert.ok(f.boundaries().some(e => e.scope === "readiness" && e.phase === "output" && e.exitCode === 1));
  assert.ok(f.boundaries().some(e => e.phase === "materialize" && e.state === "failed"));
  assert.equal(f.boundaries().some(e => e.scope === "command"), false);
  assert.equal(f.counts().commands, 0);
});

test("a broken host observer cannot fail or re-execute a business command", async () => {
  const f = fixture(); f.breakObserver();
  assert.equal((await f.install()).exitCode, 0);
  assert.equal(f.counts().commands, 1);
});

test("snapshot output reads stop their inspection VM without creating a business checkpoint", async () => {
  const f = fixture();
  const manifest = { version: 1, patterns: ["dist/**"], files: [{ path: "dist/index.html", size: 3, sha256: "a".repeat(64), executable: false }] };
  f.outputManifest(manifest);
  assert.deepEqual(await f.inspect(), manifest);
  assert.equal(f.running(), false);
  assert.deepEqual(f.counts(), { starts: 1, commands: 0, captures: 0 });
  f.outputManifest({ invalid: true });
  await assert.rejects(f.inspect());
  assert.equal(f.running(), false, "Even an invalid manifest releases its inspection VM");
});

test("snapshot output inspection cannot replace or stop uncheckpointed business work", async () => {
  const f = fixture(); await f.install(); const before = f.counts();
  await assert.rejects(f.inspect(), /uncheckpointed/);
  assert.equal(f.running(), true);
  assert.deepEqual(f.counts(), before);
  assert.ok(f.contents(await f.commit())?.includes("node_modules/.bin/vpr"));
});

test("a native source comparison cannot claim mutation ownership and block the selected action", async () => {
  const f = fixture(), head = "a".repeat(40), base = "b".repeat(40);
  const commands: string[] = [];
  let failure: string | undefined;
  const execute = f.provider().execute.bind(f.provider());
  f.provider().execute = async (...args: any[]) => {
    commands.push(args[0]);
    try { return await execute(...args); }
    catch (error) { failure = (error as Error).message; throw error; }
  };
  f.sourceQuery(`${base}\0${head}\0apps/site/index.html\0`);
  const receipts = new Map<string, unknown>();
  const runner = makeRunner({ binding: { getByName: () => f.provider() },
    repository: "https://github.com/example/public", revision: head, workspaceId: "source-query",
    step: { do: async (name: string, ...args: any[]) => {
      if (!receipts.has(name)) receipts.set(name, await args.at(-1)());
      return receipts.get(name);
    } },
  });
  const build = action("build", () => function* () {
    const source = yield* Source;
    return yield* (yield* source.checkout()).exec("npm run build");
  });
  const program = workflow("source-selection", function* () {
    const source = yield* Source;
    assert.deepEqual(yield* source.changes(), { status: "known", base, head, paths: ["apps/site/index.html"] });
    assert.equal(yield* source.changed("apps/site/**"), true);
    assert.equal(yield* source.changed("unrelated/**"), false);
    return yield* build();
  });
  try {
    await runWorkflow(program, { output: "silent", source: runner.source, executor: runner.executor,
      workspacePersistence: runner.persistence, event: { type: "push", revision: head, comparison: { base, head } } });
  } catch (error) { throw Error(failure ?? (error as Error).message); }
  assert.deepEqual(commands, ["npm run build"], "The source read must not use the mutation command adapter");
  assert.equal(f.counts().captures, 1, "Only completed build output is published, not query reads");
});

test("a source query cannot discard another action's uncheckpointed native output", async () => {
  const f = fixture(), head = "a".repeat(40), base = "b".repeat(40);
  await f.install();
  const before = f.counts();
  const runner = makeRunner({ binding: { getByName: () => f.provider() },
    repository: "https://github.com/example/public", revision: head, workspaceId: "dirty-source",
    // Checkout has already completed in the native journal. It must not run
    // again just because this subsequent read cannot inspect a dirty container.
    step: { do: async (name: string, ...args: any[]) => name === "checkout" ? undefined : args.at(-1)() },
  });
  const program = workflow("dirty-source", function* () { return yield* (yield* Source).changes(); });
  const result = await runWorkflow(program, { output: "silent", source: runner.source, executor: runner.executor,
    event: { type: "push", revision: head, comparison: { base, head } } });
  assert.deepEqual(result.value, { status: "unknown", reason: "unavailable" });
  assert.deepEqual(f.counts(), before, "A failed read cannot restart, command or capture the dirty workspace");
  assert.ok(f.contents(await f.commit())?.includes("node_modules/.bin/vpr"));
});

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
