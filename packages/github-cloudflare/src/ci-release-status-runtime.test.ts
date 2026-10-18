import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test("split reporting preserves successful CI when release fails, without claiming deployment success or hiding evidence/build failure", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import{DurableObject}from'cloudflare:workers';import*as CI from'@effect-ci-testbed/ci';
    import{workflowEntrypoint}from'./index.ts';
    const calls=[];let mode='',restored=false,finalized=false,summaryAtFinalization;
    globalThis.fetch=async(input,init)=>{
      const url=String(input);if(!url.startsWith('https://api.github.com/'))throw Error('Unexpected external request');
      if(url.endsWith('/access_tokens'))return Response.json({token:'fake-local-token'});
      const body=JSON.parse(init.body);calls.push({url,body});
      return Response.json({id:url.endsWith('/42')?42:100+calls.length,html_url:'https://github.com/owner/repo/runs/100'});
    };
    export class WorkspaceContainer extends DurableObject{}
    const program=()=>{const build=CI.action('build',()=>function*(){if(mode==='BuildFailure')throw Error('FAKE local build failure');return {artifact:'checked'};});return CI.workflow('fixture',()=>build());};
    const options=(split=true)=>({cache:false,
      ...(split?{finalizationCheck:()=> 'Deployment / fixture'}:{}),
      executionEvidence:async()=>{if(mode==='EvidenceFailure')throw Error('FAKE evidence persistence failure');return {verified:true};},
      finalize:async ctx=>{finalized=true;summaryAtFinalization=calls.filter(c=>c.url.endsWith('/42')).at(-1)?.body;
        if(mode!=='Success'){await ctx.step.do('fixture:restore',{retries:{limit:0,delay:'1 second'}},async()=>{restored=true;return {restored:true};});throw Error('FAKE unanswered review; prior allocation restored');}}
    });
    export const Split=workflowEntrypoint(program(),options());
    export const Default=workflowEntrypoint(program(),options(false));
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){mode=p.mode;calls.length=0;restored=finalized=false;summaryAtFinalization=undefined;
        await ctx.exports[p.binding].create({id:p.id,params:{trigger:'github',deliveryId:p.id,installationId:1,repository:'https://github.com/owner/repo.git',repositoryName:'owner/repo',revision:'a'.repeat(40),ref:'refs/heads/main',summaryCheckId:42}});return Response.json({started:true});}
      if(p.op==='status')return Response.json(await(await ctx.exports[p.binding].get(p.id)).status());
      return Response.json({calls,restored,finalized,summaryAtFinalization});
    }};` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "ci-release-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, Split: { type: "workflow", name: "split" }, Default: { type: "workflow", name: "default" } },
    env: { GITHUB_APP_ID: { type: "text", value: "1" }, GITHUB_PRIVATE_KEY: { type: "text", value: privateKey }, GITHUB_WEBHOOK_SECRET: { type: "text", value: "fake-secret" } },
  } }] });
  const call = async (p: unknown): Promise<any> => (await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(p) })).json();
  try {
    for (const [binding, mode] of [["Split", "ReleaseFailure"], ["Split", "Success"], ["Split", "EvidenceFailure"], ["Split", "BuildFailure"], ["Default", "ReleaseFailure"]]) {
      const id = `${binding}-${mode}`.toLowerCase();
      await call({ op: "start", binding, mode, id });
      let status: any;
      for (let n = 0; n < 200; n++) {
        status = await call({ op: "status", binding, id });
        if (["complete", "errored"].includes(status.status)) break;
        await new Promise(r => setTimeout(r, 10));
      }
      const state = await call({});
      assert.equal(status.status, mode === "Success" ? "complete" : "errored");
      const summary = state.calls.filter((c: any) => c.url.endsWith("/42")).at(-1)?.body;
      if (binding === "Split" && ["ReleaseFailure", "Success"].includes(mode)) {
        assert.equal(summary.conclusion, "success", "release failure must not rewrite completed code checks as CI failure");
        assert.equal(state.summaryAtFinalization.conclusion, "success", "CI completes before release review");
        const deployment = state.calls.filter((c: any) => c.body.name === "Deployment / fixture");
        assert.equal(deployment.length, 2, "one create and one terminal update for the separate deployment check");
        assert.equal(deployment[0].body.status, "in_progress");
        assert.equal(deployment[1].body.conclusion, mode === "Success" ? "success" : "failure");
        assert.equal(state.restored, mode === "ReleaseFailure");
      } else {
        assert.equal(summary.conclusion, "failure");
        assert.ok(!state.calls.some((c: any) => c.body.name === "Deployment / fixture"));
        if (binding === "Split") assert.equal(state.finalized, false, "missing CI evidence/build success cannot reach release");
      }
    }
  } finally { await runtime.dispose(); }
});
