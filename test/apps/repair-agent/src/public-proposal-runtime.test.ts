import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { publicProposalFixture } from "../../../../packages/github/src/public-proposal.fixture.ts";

test("generated Flue + actual local Workflow uses one new slot after private public-incident admission", { timeout: 120000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "effect-ci-public-flue-"));
  const require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const f = await publicProposalFixture();
  let runtime: InstanceType<typeof Miniflare> | undefined;
  try {
    await cp(join(pkg, "src"), join(dir, "src"), { recursive: true });
    for (const name of ["cloudflare.config.ts", "flue.config.ts", "package.json"])
      await cp(join(pkg, name), join(dir, name));
    await cp(join(pkg, "fixtures/local/public-app.ts"), join(dir, "src/app.ts"));
    await symlink(join(pkg, "node_modules"), join(dir, "node_modules"), "dir");
    execFileSync(process.execPath, [join(pkg, "node_modules/vite/bin/vite.js"), "build", dir, "--config", join(pkg, "vite.config.ts")],
      { cwd: dir, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    const output = join(dir, ".cloudflare/output/v0/workers/default");
    const config = JSON.parse(await readFile(join(output, "worker.config.json"), "utf8"));
    assert.equal(config.workersDev, false);
    assert.equal(config.env.PUBLIC_ADMISSION.worker, "effect-ci-repair-events");
    assert.equal(config.env.PUBLIC_ADMISSION.exportName, "PublicIncidentAdmission");
    assert.equal(config.exports.PublicIncidentProposalWorkflow.name, "effect-ci-public-incident-proposal");
    const modules: Record<string, { type: "esm"; contents: string }> = {};
    const bundle = join(output, "bundle");
    const load = async (path: string) => {
      for (const e of await readdir(path, { withFileTypes: true })) {
        const full = join(path, e.name);
        if (e.isDirectory()) await load(full);
        else if (e.name.endsWith(".js")) modules[relative(bundle, full)] = { type: "esm", contents: await readFile(full, "utf8") };
      }
    };
    await load(bundle);
    config.manifest = { mainModule: "index.js", modules };
    const fake = await build({ entryPoints: [join(pkg, "fixtures/local/public-budget.ts")], bundle: true, write: false,
      format: "esm", platform: "neutral", external: ["cloudflare:workers", "node:*"], conditions: ["workerd", "import"] });
    const fakeConfig = { name: "effect-ci-repair-ai", compatibilityDate: "2026-10-07",
      exports: { FakePublicBudget: { type: "durable-object", storage: "sqlite" } },
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: fake.outputFiles[0].text } } } };
    const admissionConfig = { name: "effect-ci-repair-events", compatibilityDate: "2026-10-07",
      exports: { PublicIncidentAdmission: { type: "worker" }, OwnedIncidentAdmission: { type: "worker" } },
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents:
        `import {WorkerEntrypoint} from 'cloudflare:workers';
        export class PublicIncidentAdmission extends WorkerEntrypoint {readPublicAdmission(instance){if(instance!==${JSON.stringify(f.view.instance)})throw new Error('Unknown LOCAL admission');return ${JSON.stringify(f.view)};}}
        export class OwnedIncidentAdmission extends WorkerEntrypoint {inspect(){throw new Error('Old incident must not be read')}}
        export default {fetch(){return new Response('Not found',{status:404})}}` } } } };
    runtime = new Miniflare({ workers: [{ config }, { config: fakeConfig }, { config: admissionConfig }] });
    let budget = await runtime.getWorker("effect-ci-repair-ai");
    const status = async () => budget.status();
    const call = (path: string, id = f.view.instance) => runtime!.dispatchFetch(`https://local.invalid${path}?id=${id}`);
    assert.equal((await status()).reservedCents, 50);
    assert.equal((await call("/start", "public-incident-" + "0".repeat(64))).status, 400);
    assert.equal((await status()).reservedCents, 50);
    const start = await call("/start");
    assert.equal(start.status, 200);
    assert.deepEqual(await start.json(), { id: f.view.instance });
    let complete = false;
    for (let i = 0; i < 400; i++) {
      const r = await (await call("/status")).json();
      assert.notEqual(r.status, "errored");
      if (r.status === "complete") { complete = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(complete, "local public proposal Workflow completed");
    const read = await call("/read");
    assert.equal(read.status, 200);
    const receipt = await read.json();
    assert.equal(receipt.instance, f.view.instance);
    assert.equal(receipt.admission.issue, f.view.admission.issue);
    assert.equal(receipt.text, "export function healthStatus() { return 200; }");
    assert.match(receipt.reservationId, /^flue_[a-f0-9]{64}$/);
    assert.ok(!f.before.reservations.some(r => r.id === receipt.reservationId));
    assert.equal((await status()).reservedCents, 60);
    const reload = { ...config, manifest: { ...config.manifest, modules: { ...modules,
      "index.js": { type: "esm", contents: modules["index.js"].contents + "\n// local public reload" } } } };
    await runtime.setOptions({ workers: [{ config: reload }, { config: fakeConfig }, { config: admissionConfig }] });
    budget = await runtime.getWorker("effect-ci-repair-ai");
    assert.deepEqual(await (await call("/read")).json(), receipt);
    await call("/start"); // duplicate native Workflow identity cannot execute another submission
    assert.equal((await status()).reservedCents, 60);
    await runtime.dispose();
    // A separate fresh LOCAL fixture proves the paid boundary itself, not just
    // the pure ledger helper: a valid admission with a bad ledger makes no call.
    runtime = new Miniflare({ workers: [{ config }, { config: fakeConfig }, { config: admissionConfig }] });
    budget = await runtime.getWorker("effect-ci-repair-ai");
    await budget.invalidateBudget();
    assert.equal((await call("/start")).status, 200);
    let rejected = false;
    for (let i = 0; i < 200; i++) {
      const r = await (await call("/status")).json();
      if (r.status === "errored") { rejected = true; break; }
      assert.notEqual(r.status, "complete");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(rejected);
    assert.equal((await status()).reservedCents, 50);
    assert.equal((await call("/read")).status, 400);
  } finally {
    await runtime?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
