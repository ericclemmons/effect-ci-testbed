import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { verifyRunnerStepReceipt } from "@effect-ci-testbed/cloudflare/runner-step-result";

test("the showcase consumes a signed checked build in another run and rebuilds expired snapshots", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
    import manifest from '../../../examples/demo/package.json';
    import {demoSite,demoSiteUrl} from '@effect-ci-testbed/cloudflare/demo-site';
    export {ShowcaseCIWorkflow} from './showcase-workflow.ts';
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    const snapshots=new Map(),publications=[];let sequence=0,builds=0,published;
    export class WorkspaceContainer extends DurableObject {
      files={};
      materialize(snapshot){if(!snapshot)return;const saved=snapshots.get(snapshot.id);if(!saved)throw Error('Expired snapshot');this.files={...saved}}
      checkout(){} restore(snapshot){this.materialize(snapshot)} getCachedSnapshot(){} putCachedSnapshot(){}
      stop(){}
      exists(path,_cwd,_step,snapshot){this.materialize(snapshot);return path==='.'||path==='pnpm-lock.yaml'||Object.hasOwn(this.files,path)}
      readFile(path,_cwd,_step,snapshot){this.materialize(snapshot);return path==='package.json'?JSON.stringify(manifest):this.files[path]}
      execute(command,_cwd,_step,snapshot){this.materialize(snapshot);if(command==='pnpm build'){builds++;this.files={'dist/index.html':'<h1>build '+builds+'</h1>','dist/app.js':'export const build='+builds,'dist/message.js':'export const message="hello"'}}return{exitCode:0,stdout:'completed',stderr:''}}
      checkpoint(name){const snapshot={id:'snapshot-'+(++sequence),name,size:1};snapshots.set(snapshot.id,{...this.files});return snapshot}
    }
    export class Publisher extends WorkerEntrypoint {async publish(revision,assets){publications.push({revision,assets});published=await demoSite(revision,assets);return{revision,digest:published.digest,url:demoSiteUrl(published)}}}
    globalThis.fetch=async input=>{const name=new URL(String(input)).pathname.split('/').at(-1);return new Response(published.assets[name],{headers:{'x-site-revision':published.revision,'x-site-digest':published.digest}})};
    export default{async fetch(request,env,ctx){const input=await request.json();
      if(input.op==='start'){await ctx.exports.ShowcaseCIWorkflow.create({id:input.id,params:{trigger:'remote',repository:'https://github.com/ericclemmons/effect-ci-testbed.git',revision:input.revision??'a'.repeat(40)}});return Response.json(true)}
      if(input.op==='status')return Response.json(await(await ctx.exports.ShowcaseCIWorkflow.get(input.id)).status());
      if(input.op==='expire'){snapshots.delete(input.snapshot);return Response.json(true)}
      return Response.json({builds,publications});
    }};
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] });
  const name = "showcase-workspace-probe";
  const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, TrustedDemoChecks: { type: "durable-object", storage: "sqlite" }, ShowcaseCIWorkflow: { type: "workflow", name }, Publisher: { type: "worker" } },
    env: { VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } }, DEMO_SITE: { type: "worker", worker: name, exportName: "Publisher" } },
  } }] });
  const call = async (body: unknown): Promise<any> => (await runtime.dispatchFetch("https://probe.invalid", { method: "POST", body: JSON.stringify(body) })).json();
  const run = async (id: string, revision?: string) => {
    await call({ op: "start", id, revision });
    for (let i = 0; i < 200; i++) {
      const status = await call({ op: "status", id });
      assert.notEqual(status.status, "errored", JSON.stringify(status.error));
      if (status.status === "complete") return status.output;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Showcase did not finish");
  };
  try {
    const first = await run("first");
    const second = await run("second");
    assert.equal(second.nodes.find((node: any) => node.id === "build").status, "reused");
    const receipt = first.evidence.stepResults[0];
    const key = await crypto.subtle.importKey("jwk", first.evidence.publicKey, "Ed25519", false, ["verify"]);
    assert.deepEqual(await verifyRunnerStepReceipt(JSON.stringify(receipt), receipt.claim.identity, new Map([[first.evidence.keyId, key]])), receipt.claim.result);
    let state = await call({ op: "state" });
    assert.equal(state.builds, 1);
    assert.deepEqual(state.publications[1].assets, state.publications[0].assets);
    assert.equal(second.evidence.publication.revision, "a".repeat(40));
    assert.ok(second.evidence.publication.url.endsWith("/index.html"));
    assert.equal(second.evidence.publication.digest, first.evidence.publication.digest);
    await call({ op: "expire", snapshot: receipt.claim.result.snapshot.id });
    const rebuilt = await run("rebuilt");
    assert.equal(rebuilt.nodes.find((node: any) => node.id === "build").status, "complete");
    await run("changed", "b".repeat(40));
    state = await call({ op: "state" });
    assert.equal(state.builds, 3);
    assert.equal(state.publications.length, 4);
  } finally { await runtime.dispose(); }
});
