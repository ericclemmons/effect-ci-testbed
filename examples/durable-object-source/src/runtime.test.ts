import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { parameters, manifest, sourceId } from "./fixture.ts";

test("fixed source selection rejects caller authority and accessors", () => {
  const revision = createHash("sha256").update(manifest()).digest("hex");
  assert.equal(revision, "c79e699009991bf593f593ae81b03241c6de16447d4598ba66bee96d8b2eeed9");
  assert.deepEqual(parameters({ repository: sourceId, revision }), { repository: sourceId, revision });
  for (const bad of [{ repository: "foreign", revision }, { repository: sourceId, revision, mode: "write" },
    { repository: sourceId, revision: "latest" }, { repository: sourceId, revision, [Symbol()]: true }]) assert.throws(() => parameters(bad));
  let invoked = false;
  assert.throws(() => parameters({ repository: sourceId, get revision() { invoked = true; return revision; } }));
  assert.equal(invoked, false);
});

test("actual local Workflow/SQLite RPC retains bounds, immutable replay and isolated corruption denial", { timeout: 60000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url)), require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const code = (await build({ stdin: { resolveDir: pkg, loader: "ts", contents: `
    import {WorkerEntrypoint} from 'cloudflare:workers';
    export {SourceRevisions,SourceIntegrityFixture,SourceBoundaryWorkflow} from './src/worker.ts';
    export default class extends WorkerEntrypoint {async fetch(req){const u=new URL(req.url),w=this.ctx.exports.SourceBoundaryWorkflow;
      if(u.pathname==='/start'){const p=await req.json();return Response.json(await w.create({id:p.id,params:p.params}));}
      return Response.json(await(await w.get(u.searchParams.get('id'))).status());}}
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"],
    external: ["node:*", "cloudflare:workers", "cloudflare:workflows"] })).outputFiles[0].text;
  const config = (contents: string) => ({ name: "owned-durable-source-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    exports: { SourceRevisions: { type: "durable-object", storage: "sqlite" }, SourceIntegrityFixture: { type: "durable-object", storage: "sqlite" },
      SourceBoundaryWorkflow: { type: "workflow", name: "local-source-boundaries" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } } });
  const runtime = new Miniflare({ workers: [{ config: config(code) }] });
  const run = async (id: string, params: unknown) => {
    const response = await runtime.dispatchFetch("https://local.invalid/start", { method: "POST", body: JSON.stringify({ id, params }) });
    assert.equal(response.status, 200);
    for (let i = 0; i < 200; i++) {
      const h = await (await runtime.dispatchFetch(`https://local.invalid/status?id=${id}`)).json();
      if (["complete", "errored"].includes(h.status)) return h;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error("Local native Workflow did not settle");
  };
  try {
    const first = await run("first", { mode: "verify-owned-boundaries" });
    assert.equal(first.status, "complete", JSON.stringify(first));
    assert.deepEqual(first.output.bounds, { initialCreated: true, replayCreated: false, conflictRejected: true,
      revisions: 32, overflowRejected: true, fullStoreReplayCreated: false, originalReadable: true });
    assert.deepEqual(first.output.corruption, { rejected: true, reason: "Source digest mismatch" });
    assert.equal(first.output.materializationPerformed, false); // No container binding exists in this test runtime.
    await runtime.setOptions({ workers: [{ config: config(code + "\n// reload\n") }] });
    const replay = await run("replay", { mode: "verify-owned-boundaries" });
    assert.equal(replay.status, "complete", JSON.stringify(replay));
    assert.deepEqual(replay.output, { ...first.output, bounds: { ...first.output.bounds, initialCreated: false } });
    for (const [i, params] of [null, { mode: "verify-owned-boundaries", id: "foreign" }, { mode: "reset" }].entries())
      assert.equal((await run("invalid-" + i, params)).status, "errored");
    assert.deepEqual((await (await runtime.dispatchFetch("https://local.invalid/status?id=first")).json()).output, first.output);
  } finally { await runtime.dispose(); }
});

test("recipe owns its configuration, image and fixture without other app implementation imports", async () => {
  const root = new URL("../", import.meta.url);
  for (const name of ["src/worker.ts", "src/fixture.ts", "cloudflare.config.ts", "vite.config.ts", ".cloudflare/ci/standalone.ts"])
    assert.doesNotMatch(await readFile(new URL(name, root), "utf8"), /(?:\.\.\/)+(?:apps|examples)\//);
  assert.doesNotMatch(await readFile(new URL("tsconfig.json", root), "utf8"), /"extends"/);
  assert.match(await readFile(new URL("cloudflare.config.ts", root), "utf8"), /workersDev: false/);
  assert.match(await readFile(new URL("Dockerfile", root), "utf8"), /node:24-trixie-slim@sha256:/);
});
