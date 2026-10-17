import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RUNNER_LABEL } from "./policy.ts";

test("actual local Worker + SQLite pool: signed ingress, durable replay protection, queue and lost-ACK quarantine across reload", { timeout: 60000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url));
  const require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const policy = { enabled: true, appId: 1, installationId: 2, repositoryId: 3,
    repository: "fixture/private", runnerGroupId: 1, lifetimeSeconds: 900 };
  const source = `
    import Base,{RunnerPool as Pool,ActionsRunner as Runner} from './src/worker.ts';
    export class RunnerPool extends Pool {
      async inspect(){return await this.ctx.storage.get('selected-repository-v1')??null;}
      async tick(){return super.alarm();}
    }
    export class ActionsRunner extends Runner {async inspect(){return await this.ctx.storage.get('lease')??null;}}
    export default class extends Base {
      async fetch(request){
        const url=new URL(request.url), pool=this.ctx.exports.RunnerPool.getByName('selected-repository-v1');
        if(url.pathname==='/_fixture/pool')return Response.json(await pool.inspect());
        if(url.pathname==='/_fixture/tick'){await pool.tick();return new Response('ok');}
        if(url.pathname==='/_fixture/runner')return Response.json(await this.ctx.exports.ActionsRunner.getByName(url.searchParams.get('name')).inspect());
        return super.fetch(request);
      }
    }`;
  const bundle = async (enabled: boolean) => (await build({ stdin: { contents: source, resolveDir: pkg, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "esnext", external: ["cloudflare:workers"],
    plugins: [{ name: "local-only-enrollment-and-github", setup(builder: any) {
      builder.onLoad({ filter: /enrollment\.ts$/ }, () => ({ loader: "ts", contents: `export const enrollment=${JSON.stringify({ ...policy, enabled })};` }));
      // All network is routed to a second local Worker; no GitHub token or JIT
      // registration is requested. Lost POST ACK is deliberate fixture evidence.
      builder.onLoad({ filter: /github\.ts$/ }, () => ({ loader: "ts", contents: `export class GitHub {
        async token(){return 'LOCAL-ONLY';}
        async authorize(){return true;}
        async jit(){await fetch('https://local-api.invalid/mint');throw Error('LOCAL lost JIT ACK');}
        async find(){return undefined;}
        async runner(){return true;}
        async remove(){throw Error('LOCAL unexpected removal');}
      }` }));
    } }],
  })).outputFiles[0].text;
  const disabled = await bundle(false), enabled = await bundle(true);
  const secret = "a".repeat(64);
  const manifest = (contents: string) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
  const options = (code: string) => ({ workers: [
    { config: { name: "local-runner", compatibilityDate: "2026-10-07",
      env: { RUNNER_WEBHOOK_SECRET: { type: "text", value: secret }, RUNNER_APP_PRIVATE_KEY: { type: "text", value: "LOCAL-ONLY" } },
      exports: { RunnerPool: { type: "durable-object", storage: "sqlite" }, ActionsRunner: { type: "durable-object", storage: "sqlite" } },
      manifest: manifest(code) }, dev: { outboundService: { type: "worker", worker: "local-api" } } },
    { config: { name: "local-api", compatibilityDate: "2026-10-07", exports: { Counter: { type: "durable-object", storage: "sqlite" } },
      manifest: manifest(`import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
        export class Counter extends DurableObject {async count(increment){let n=await this.ctx.storage.get('n')??0;if(increment){n++;await this.ctx.storage.put('n',n);}return n;}}
        export default class extends WorkerEntrypoint {async fetch(request){return Response.json(await this.ctx.exports.Counter.getByName('local').count(new URL(request.url).pathname==='/mint'));}}`) } },
  ] });
  const runtime = new Miniflare(options(disabled));
  const repository = { id: 3, full_name: "fixture/private", private: true };
  const event = (id: number) => ({ action: "queued", installation: { id: 2 }, repository,
    workflow_job: { id, run_id: 5, run_attempt: 1, head_sha: "a".repeat(40), status: "queued", conclusion: null, labels: [RUNNER_LABEL] } });
  const post = (body: unknown, signed = true) => {
    const raw = JSON.stringify(body);
    return runtime.dispatchFetch("https://local.invalid/github/webhook", { method: "POST", body: raw,
      headers: { "x-github-event": "workflow_job", "x-hub-signature-256": signed ? `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` : "sha256=invalid" } });
  };
  const inspect = async () => (await runtime.dispatchFetch("https://local.invalid/_fixture/pool")).json();
  const tick = () => runtime.dispatchFetch("https://local.invalid/_fixture/tick");
  try {
    assert.equal((await post(event(4))).status, 503);
    await runtime.setOptions(options(enabled));
    assert.equal((await post(event(4), false)).status, 401);
    assert.equal((await post({ ...event(4), repository: { ...repository, private: false } })).status, 202);
    assert.equal(await inspect(), null);
    const responses = await Promise.all(Array.from({ length: 8 }, () => post(event(4))));
    const states = await Promise.all(responses.map((r: Response) => r.json()));
    assert.equal(states.filter((s: any) => s.state === "queued").length, 1);
    assert.equal(states.filter((s: any) => s.state === "duplicate").length, 7);
    await tick();
    assert.equal((await post(event(6))).status, 202);
    await tick();
    let pool = await inspect();
    assert.equal(pool.queue.length, 1); assert.deepEqual(pool.seen, ["4-1", "6-1"]);
    const name = pool.active.name;
    const lease = await (await runtime.dispatchFetch(`https://local.invalid/_fixture/runner?name=${name}`)).json();
    assert.equal(lease.phase, "quarantined"); assert.equal(lease.job.id, 4);
    assert.doesNotMatch(JSON.stringify({ pool, lease }), /LOCAL-ONLY|LOCAL lost JIT ACK|encoded_jit_config/);
    const api = await runtime.getWorker("local-api");
    assert.equal(await (await api.fetch("https://local-api.invalid/count")).json(), 1);
    // Restart the actual Worker module, leaving the same SQLite durable state.
    await runtime.setOptions(options(enabled + "\n// reload"));
    assert.equal((await (await post(event(4))).json()).state, "duplicate");
    await tick();
    pool = await inspect(); assert.equal(pool.active.name, name); assert.equal(pool.queue.length, 1);
    assert.equal(await (await (await runtime.getWorker("local-api")).fetch("https://local-api.invalid/count")).json(), 1);
    assert.equal((await runtime.dispatchFetch("https://local.invalid/arbitrary-dispatch", { method: "POST" })).status, 404);
  } finally { await runtime.dispose(); }
});
