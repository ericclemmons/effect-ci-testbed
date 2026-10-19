import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { verifyRunnerStepReceipt } from "@effect-ci-testbed/cloudflare/runner-step-result";
const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test("native runs reuse a signed build snapshot, publish its bytes, and rebuild after that snapshot expires", { timeout: 30_000 }, async () => {
  // Actual CI/Workflow/SQLite/RPC/signatures, simulated immutable provider
  // snapshots and commands. No actual container, upload or production traffic.
  const output = await build({ stdin: { contents: `
    import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
    import manifest from '../../../test/fixtures/demo/package.json';
    import {demoSite,demoSiteUrl} from '@effect-ci-testbed/cloudflare/demo-site';
    export {DemoCIWorkflow} from './demo-workflow.ts';
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    const snapshots=new Map(),commands=[],publications=[];let sequence=0,builds=0;
    export class WorkspaceContainer extends DurableObject {
      files={};
      materialize(revision){if(!revision)return;const saved=snapshots.get(revision.id);if(!saved)throw Error('Snapshot expired');this.files={...saved}}
      checkout(){} restore(revision){this.materialize(revision)} getCachedSnapshot(){} putCachedSnapshot(){}
      exists(path,_cwd,_step,revision){this.materialize(revision);return path==='.'||path==='package-lock.json'||Object.hasOwn(this.files,path)}
      readFile(path,_cwd,_step,revision){this.materialize(revision);return path==='package.json'?JSON.stringify(manifest):this.files[path]}
      execute(command,_cwd,_step,revision){
        this.materialize(revision);commands.push(command);
        if(command==='npm run "build"'){builds++;this.files={'dist/index.html':'<h1>build '+builds+'</h1>','dist/app.js':'export const build='+builds,'dist/message.js':'export const message="hello"'}}
        if(command.endsWith('verify-build.ts')&&!this.files['dist/index.html'])throw Error('Build artifact was lost');
        return {exitCode:0,stdout:'fixture process',stderr:''};
      }
      checkpoint(name){const value={id:'snapshot-'+(++sequence),name,size:1};snapshots.set(value.id,{...this.files});return value}
    }
    export class Publisher extends WorkerEntrypoint {
      async publish(revision,assets){publications.push({revision,assets});const site=await demoSite(revision,assets);return {...site,url:demoSiteUrl(site)}}
      prepareCandidate(){throw Error('Preview must never prepare production')}
    }
    export default {async fetch(request,env,ctx){
      const url=new URL(request.url),id=url.searchParams.get('id')||'first';
      const revision=url.searchParams.get('revision')||'a'.repeat(40);
      if(url.pathname==='/start'){await ctx.exports.DemoCIWorkflow.create({id,params:{trigger:'remote',repository:'https://github.com/ericclemmons/effect-ci-testbed.git',revision}});return Response.json({started:true})}
      if(url.pathname==='/status')return Response.json(await(await ctx.exports.DemoCIWorkflow.get(id)).status());
      if(url.pathname==='/expire'){snapshots.delete(url.searchParams.get('snapshot'));return Response.json({expired:true})}
      if(url.pathname==='/replay-old'){const evidence=await(await(await ctx.exports.DemoCIWorkflow.get('first')).status()).output.evidence;await ctx.exports.TrustedDemoChecks.getByName('demo-trusted-runner-v1').recordStepResult(evidence.stepResults[0].claim);return Response.json({replayed:true})}
      return Response.json({builds,commands,publications});
    }};`, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "workspace-result-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", platform: "neutral", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] });
  const name = "demo-workspace-results-probe";
  const runtime = new Miniflare({ workers: [{ config: { name,
    compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, TrustedDemoChecks: { type: "durable-object", storage: "sqlite" },
      DemoCIWorkflow: { type: "workflow", name }, Publisher: { type: "worker" } },
    env: { VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } },
      DEMO_SITE: { type: "worker", worker: name, exportName: "Publisher" }, RELEASE_MANAGER: { type: "worker", worker: name, exportName: "Publisher" } },
  } }] });
  const run = async (id: string, revision = "a".repeat(40)) => {
    await runtime.dispatchFetch(`https://probe.invalid/start?id=${id}&revision=${revision}`);
    for (let attempt = 0; attempt < 200; attempt++) {
      const status = await (await runtime.dispatchFetch(`https://probe.invalid/status?id=${id}`)).json();
      assert.notEqual(status.status, "errored", JSON.stringify(status.error));
      if (status.status === "complete") return status.output;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail("Workspace result probe did not complete");
  };
  try {
    const first = await run("first"), second = await run("second");
    const receipt = first.evidence.stepResults[0];
    assert.equal(receipt.claim.runId, "first");
    assert.deepEqual(second.evidence.stepResults, first.evidence.stepResults);
    assert.equal(second.nodes.find((node: { id: string }) => node.id === "build").status, "reused");
    let state = await (await runtime.dispatchFetch("https://probe.invalid/state")).json();
    assert.equal(state.builds, 1); assert.equal(state.publications.length, 2);
    assert.deepEqual(state.publications[1].assets, state.publications[0].assets, "consumer receives the exact saved build bytes");
    const key = await crypto.subtle.importKey("jwk", first.evidence.publicKey, "Ed25519", false, ["verify"]);
    assert.deepEqual(await verifyRunnerStepReceipt(JSON.stringify(receipt), receipt.claim.identity,
      new Map([[first.evidence.keyId, key]])), receipt.claim.result);
    await runtime.dispatchFetch(`https://probe.invalid/expire?snapshot=${receipt.claim.result.snapshot.id}`);
    const rebuilt = await run("rebuilt");
    assert.equal(rebuilt.nodes.find((node: { id: string }) => node.id === "build").status, "complete");
    assert.equal(rebuilt.evidence.stepResults[0].claim.runId, "rebuilt");
    await runtime.dispatchFetch("https://probe.invalid/replay-old");
    const fourth = await run("after-replay");
    assert.equal(fourth.evidence.stepResults[0].claim.runId, "rebuilt", "an old replay cannot move the result pointer backwards");
    assert.equal(fourth.nodes.find((node: { id: string }) => node.id === "build").status, "reused");
    await run("changed-commit", "b".repeat(40));
    state = await (await runtime.dispatchFetch("https://probe.invalid/state")).json();
    assert.equal(state.builds, 3); assert.equal(state.publications.length, 5);
    assert.equal(state.publications[0].assets["index.html"], "<h1>build 1</h1>");
    assert.equal(state.publications[2].assets["index.html"], "<h1>build 2</h1>");
    assert.equal(state.publications[3].assets["index.html"], "<h1>build 2</h1>");
  } finally { await runtime.dispose(); }
});
