import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

test("actual local R2/Workflow/SQLite RPC restores source and fails closed before FAKE container materialization", { timeout: 60000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url)), require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const manifest = await readFile(join(pkg, "source.json"), "utf8");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const digest = hash(manifest), key = `source/${digest}.json`;
  const unsafe = JSON.stringify({ version: 1, files: [{ path: "../escape", base64: "eA==", executable: false }] });
  const unsafeDigest = hash(unsafe), unsafeKey = `source/${unsafeDigest}.json`;
  const code = (await build({ stdin: { resolveDir: pkg, loader: "ts", contents: `
    import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
    export {R2SourceWorkflow} from './src/worker.ts';
    export class SnapshotStore extends DurableObject {
      async record(kind,value){const a=(await this.ctx.storage.get(kind))??[];a.push(value);await this.ctx.storage.put(kind,a);}
      async save(files){const n=((await this.ctx.storage.get('sequence'))??0)+1;await this.ctx.storage.put('sequence',n);const id='snapshot-'+n;await this.ctx.storage.put(id,files);return{id,name:id,size:1};}
      async load(id){await this.record('restores',id);const f=await this.ctx.storage.get(id);if(!f)throw Error('Missing fake snapshot');return f;}
      async stats(){return {materializations:(await this.ctx.storage.get('materializations'))??[],commands:(await this.ctx.storage.get('commands'))??[],restores:(await this.ctx.storage.get('restores'))??[]};}
    }
    export class WorkspaceContainer extends DurableObject {
      store(){return this.ctx.exports.SnapshotStore.getByName('local');}
      async prepare(snapshot){if(snapshot&&await this.ctx.storage.get('active')!==snapshot.id){await this.ctx.storage.put('files',await this.store().load(snapshot.id));await this.ctx.storage.put('active',snapshot.id);}}
      async materializeSource(files,options){if(JSON.stringify([files,options]).includes('local-storage-secret'))throw Error('Host secret leaked');await this.ctx.storage.put('files',files);await this.store().record('materializations',{container:this.ctx.id.toString(),files});}
      async exists(path,cwd,step,snapshot){await this.prepare(snapshot);return path==='.'&&!!await this.ctx.storage.get('files');}
      async checkpoint(){return this.store().save(await this.ctx.storage.get('files'));}
      async readFile(path,cwd,step,snapshot){await this.prepare(snapshot);const f=(await this.ctx.storage.get('files'))?.find(f=>f.path===path);return f?atob(f.base64):undefined;}
      async execute(command,cwd,step,snapshot){await this.prepare(snapshot);if(cwd!=='/workspace/repository'||!snapshot)throw Error('Consumer did not restore');const f=(await this.ctx.storage.get('files'))?.find(f=>f.path==='source.txt');if(!f||atob(f.base64)!=='source from r2\\n')throw Error('Restored bytes mismatch');await this.store().record('commands',{container:this.ctx.id.toString(),snapshot:snapshot.id,command});return{exitCode:0,stdout:'LOCAL simulated container verifier',stderr:''};}
    }
    // LOCAL-only preparation/status adapter, never the shipped private Worker.
    export default class extends WorkerEntrypoint {async fetch(request){const url=new URL(request.url),w=this.ctx.exports.R2SourceWorkflow;
      if(url.pathname==='/seed'){const p=await request.json();await this.env.SOURCE_BUCKET.put(p.key,p.body);return new Response('seeded');}
      if(url.pathname==='/start'){const p=await request.json();return Response.json(await w.create({id:p.id,params:p.params}));}
      if(url.pathname==='/status')return Response.json(await(await w.get(url.searchParams.get('id'))).status());
      return Response.json(await this.ctx.exports.SnapshotStore.getByName('local').stats());}}
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"],
    external: ["node:*", "cloudflare:workers", "cloudflare:workflows"] })).outputFiles[0].text;
  const config = (contents: string) => ({ name: "local-r2-source", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    env: { SOURCE_BUCKET: { type: "r2", name: "local-private-source" }, LOCAL_STORAGE_SECRET: { type: "text", value: "local-storage-secret" } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, SnapshotStore: { type: "durable-object", storage: "sqlite" },
      R2SourceWorkflow: { type: "workflow", name: "local-r2-source-checks" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } },
  });
  const runtime = new Miniflare({ workers: [{ config: config(code) }] });
  try {
    const post = (path: string, value: unknown) => runtime.dispatchFetch(`https://local.invalid/${path}`, { method: "POST", body: JSON.stringify(value) });
    assert.equal((await post("seed", { key, body: manifest })).status, 200);
    assert.equal((await post("seed", { key: unsafeKey, body: unsafe })).status, 200);
    const state = async (id: string) => (await runtime.dispatchFetch(`https://local.invalid/status?id=${id}`)).json();
    const wait = async (id: string) => {
      let h: any;
      for (let i = 0; i < 200; i++) { h = await state(id); if (["complete", "errored"].includes(h.status)) return h; await new Promise(resolve => setTimeout(resolve, 20)); }
      throw Error(`Local Workflow did not settle: ${JSON.stringify(h)}`);
    };
    assert.equal((await post("start", { id: "valid", params: { repository: key, revision: digest } })).status, 200);
    const valid = await wait("valid"); assert.equal(valid.status, "complete", JSON.stringify(valid));
    assert.equal(valid.output.verified, true);
    const initial = await (await runtime.dispatchFetch("https://local.invalid/stats")).json();
    assert.equal(initial.materializations.length, 1); assert.equal(initial.commands.length, 1); assert.ok(initial.restores.length >= 1);
    assert.notEqual(initial.commands[0].container, initial.materializations[0].container);
    for (const [id, params] of [
      ["wrong-digest", { repository: key, revision: "0".repeat(64) }],
      ["missing", { repository: `source/${"f".repeat(64)}.json`, revision: "f".repeat(64) }],
      ["unsafe", { repository: unsafeKey, revision: unsafeDigest }],
      ["extra", { repository: key, revision: digest, actor: "forbidden" }],
    ] as const) {
      assert.equal((await post("start", { id, params })).status, 200);
      assert.equal((await wait(id)).status, "errored");
    }
    const final = await (await runtime.dispatchFetch("https://local.invalid/stats")).json();
    assert.deepEqual(final, initial); // No invalid source reached a container.
    assert.ok(!JSON.stringify(final).includes("local-storage-secret"));
    await runtime.setOptions({ workers: [{ config: config(code + "\n// local reload\n") }] });
    assert.equal((await state("valid")).status, "complete");
    assert.deepEqual(await (await runtime.dispatchFetch("https://local.invalid/stats")).json(), final);
  } finally { await runtime.dispose(); }
});
