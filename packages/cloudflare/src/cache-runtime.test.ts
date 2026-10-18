import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test("transport caches follow the resolved runtime image, not its mutable alias", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({
    stdin: {
      resolveDir: new URL(".", import.meta.url).pathname,
      loader: "ts",
      contents: `
      import * as Effect from 'effect/Effect';
      import {makeRunner,WorkspaceContainer} from './index.ts';
      const snapshots=new Map();let serial=0;
      export default{async fetch(request){const input=await request.json();
        if(input.op==='image')return Response.json({image:await WorkspaceContainer.prototype.getImageIdentity.call({container:()=>({images:input.images})},input.options)??null});
        const events=[],primary={
          getImageIdentity:async()=>input.image,
          checkout:async()=>{events.push('checkout');},
          readFile:async()=> 'unchanged-lockfile',
          restore:async(snapshot)=>{events.push('restore:'+snapshot.id);},
          checkpoint:async()=>({id:'snapshot-'+(++serial),size:1}),
        };
        const binding={getByName(name){
          if(name==='current')return primary;
          events.push('namespace:'+name);
          return{getCachedSnapshot:async()=>snapshots.get(name),putCachedSnapshot:async(_,value)=>{events.push('write:'+name);snapshots.set(name,value);}};
        }};
        const runner=makeRunner({binding,workspaceId:'current',repository:'https://github.com/acme/project.git',revision:input.revision??'a'.repeat(40),
          cache:input.disabled?undefined:{key:'dependencies',keyFiles:['pnpm-lock.yaml'],paths:['node_modules']},
          container:{image:'workspace',loginShell:false},step:{do:async(name,body)=>input.legacyReplay&&name==='workspace-cache:identity'?'cache:v2:old-alias-only':body()}});
        const workspace=await Effect.runPromise(runner.source.checkout());
        await Effect.runPromise(runner.persistence.commit({stepId:'install',workspace}));
        return Response.json(events);
      }};`,
    },
    bundle: true, write: false, format: "esm", target: "esnext",
    conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"],
  });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "cache-runtime-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
  } }] });
  const call = async (input: unknown): Promise<any> => {
    const response = await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: JSON.stringify(input) });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body);
  };
  const imageA = `sha256:${"a".repeat(64)}`;
  const imageB = `sha256:${"b".repeat(64)}`;
  try {
    const first: string[] = await call({ image: imageA });
    const same: string[] = await call({ image: imageA, revision: "b".repeat(40) });
    assert.equal(same.find(e => e.startsWith("namespace:")), first.find(e => e.startsWith("namespace:")));
    assert.ok(same.includes("restore:snapshot-1"), JSON.stringify(same));
    const changed: string[] = await call({ image: imageB });
    assert.notEqual(changed.find(e => e.startsWith("namespace:")), first.find(e => e.startsWith("namespace:")));
    assert.ok(!changed.some(e => e.startsWith("restore:")), JSON.stringify(changed));
    assert.match(changed.find(e => e.startsWith("namespace:"))!, /^namespace:cache:v3:/);
    for (const input of [{}, { disabled: true }, { image: imageA, legacyReplay: true }]) {
      const fresh: string[] = await call(input);
      assert.deepEqual(fresh.filter(e => /^(namespace|write|restore):/.test(e)), []);
      assert.ok(fresh.includes("checkout"));
    }
    assert.deepEqual(await call({ op: "image", images: { workspace: imageA }, options: { image: "workspace" } }), { image: imageA });
    assert.deepEqual(await call({ op: "image", images: { workspace: imageB }, options: { image: "workspace" } }), { image: imageB });
    assert.deepEqual(await call({ op: "image", images: { "cloudflare/debian-trixie": imageA } }), { image: imageA });
    assert.deepEqual(await call({ op: "image", images: {}, options: { image: "mutable:latest" } }), { image: null });
    assert.deepEqual(await call({ op: "image", images: {}, options: { image: `registry.example/image@${imageA}` } }), { image: `registry.example/image@${imageA}` });
    assert.deepEqual(await call({ op: "image", images: {}, options: { image: imageA } }), { image: imageA });
    assert.deepEqual(await call({ op: "image", images: {}, options: { image: "image@sha256:bad" } }), { image: null });
  } finally {
    await runtime.dispose();
  }
});
