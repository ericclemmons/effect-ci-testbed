import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }));
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }));

test("native SQLite reviewer approves README-only changes without history or receipts, journals once and reconciles lost ACK", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "review-probe.ts", loader: "ts", contents: `
    import {SmallChangeReviews,withSmallChangeToken} from './small-change-review.ts';
    export {SmallChangeReviews};
    export {SmallChangeReviewWorkflow} from './small-change-review.ts';
    const head='a'.repeat(40),base='b'.repeat(40),repo='ericclemmons/effect-ci-testbed';
    const checks=[],reviews=[],requests=[];let failReview=false,extraPermissions=false,renamed=false,variant='readme';
    const diff=()=>variant==='mixed'?[{filename:'README.md',status:'modified',additions:1,deletions:1},{filename:'src/index.ts',status:'modified',additions:1,deletions:1}]:
      [{filename:variant==='code'?'src/index.ts':variant==='nested'?'docs/README.md':'README.md',status:variant==='rename'?'renamed':'modified',
        ...(variant==='rename'?{previous_filename:'src/index.ts'}:{}),additions:5000,deletions:5000,patch:'-old\\n+new'}];
    globalThis.fetch=async (url,init={})=>{
      const u=new URL(url),method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;
      requests.push({path:u.pathname,method,body,redirect:init.redirect});
      if(u.pathname.includes('/access_tokens'))return Response.json({token:'fixture-installation-token',permissions:{contents:'read',checks:'write',pull_requests:'write',metadata:'read',...(extraPermissions?{administration:'write'}:{})}});
      if(u.pathname==='/installation/token')return new Response(null,{status:204});
      const path=u.pathname.replace('/repos/'+repo,'');
      if(method==='POST'&&path==='/check-runs'){const r={...body,id:checks.length+1,app:{id:5089816}};checks.push(r);return Response.json(r)}
      if(method==='POST'&&/^\\/pulls\\/\\d+\\/reviews$/.test(path)){
        const r={...body,id:reviews.length+1,state:'APPROVED',user:{id:334321206,type:'Bot',login:renamed?'cleaner-name[bot]':'effect-ci[bot]'}};reviews.push(r);
        if(failReview){failReview=false;throw Error('lost ACK: Bearer fixture-installation-token')}
        return Response.json(r);
      }
      if(/^\\/pulls\\/(50|51|52|53|54|55|56)$/.test(path))return Response.json({number:Number(path.split('/').at(-1)),base:{sha:base,repo:{full_name:repo}},head:{sha:head,repo:{full_name:repo}},user:{id:7},changed_files:diff().length,state:'open',draft:false});
      if(path.startsWith('/compare/'))return Response.json({base_commit:{sha:base},files:diff()});
      if(path==='/pulls')throw Error('README policy must not fetch author history');
      if(/^\\/pulls\\/\\d+\\/files$/.test(path))return Response.json([{filename:'README.md'}]);
      if(path.startsWith('/commits/'))return Response.json({total_count:checks.length,check_runs:checks});
      if(path.endsWith('/reviews'))return Response.json(reviews);
      throw Error('Unexpected fixture request '+path);
    };
    export default {async fetch(request,env,ctx){
      const path=new URL(request.url).pathname;
      const owner=n=>ctx.exports.SmallChangeReviews.getByName('pr-'+n);
      try{
        if(path==='/start'){await ctx.exports.SmallChangeReviewWorkflow.create({id:'policy-native',params:{number:52}});return Response.json({started:true})}
        if(path==='/status')return Response.json(await(await ctx.exports.SmallChangeReviewWorkflow.get('policy-native')).status());
        if(path==='/stale-policy')return Response.json(await owner(50).read(50,'00000000-0000-4000-8000-000000000000'));
        if(path==='/stale-approval')return Response.json(await owner(50).publish(50,{}, {},'00000000-0000-4000-8000-000000000000'));
        const scenario={code:53,nested:54,rename:55,mixed:56}[path.slice(1)];
        if(scenario){variant=path.slice(1);try{return Response.json(await owner(scenario).evaluate(scenario))}finally{variant='readme'}}
        if(path==='/lost'){failReview=true;return Response.json(await owner(51).evaluate(51))}
        if(path==='/reconcile'){renamed=true;for(const review of reviews)review.user.login='cleaner-name[bot]';return Response.json(await owner(51).evaluate(51))}
        if(path==='/extra-permissions'){extraPermissions=true;try{await withSmallChangeToken(env,()=>{throw Error('Must not run operation')})}finally{extraPermissions=false} }
        if(path==='/review')return Response.json(await owner(50).evaluate(50));
        return Response.json({checks,reviews,requests});
      }catch(error){return Response.json({error:String(error)}, {status:500})}
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", platform: "neutral",
    external: ["cloudflare:workers", "node:*"], conditions: ["workerd", "import"] });
  const name = "small-change-native-probe";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { SmallChangeReviews: { type: "durable-object", storage: "sqlite" },
      SmallChangeReviewWorkflow: { type: "workflow", name: "small-change-native-policy" } },
    env: { GITHUB_APP_ID: { type: "text", value: "5089816" },
      GITHUB_PRIVATE_KEY: { type: "text", value: privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } } },
  } }] });
  const get = async (path: string) => (await runtime.dispatchFetch(`https://probe.invalid${path}`)).json();
  try {
    const first = await get("/review"), replay = await get("/review");
    assert.equal(first.state, "complete"); assert.equal(first.decision.eligible, true); assert.deepEqual(replay, first);
    let observed = await get("/observed");
    assert.equal(observed.reviews.length, 1);
    assert.equal(observed.checks.length, 1);
    assert.match(observed.reviews[0].body, /trusted organization policy passed/);
    assert.doesNotMatch(observed.reviews[0].body, /verified checks and org review passed/);
    assert.match(observed.reviews[0].body, /effect-ci-small-change:demo-readme-only-v2:/);
    assert.match((await get("/lost")).error, /transport unavailable/);
    assert.equal((await get("/reconcile")).state, "complete");
    observed = await get("/observed");
    assert.equal(observed.reviews.length, 2); // no second review after ACK loss
    assert.equal(observed.reviews[1].user.login, "cleaner-name[bot]");
    const oldCount = observed.requests.length;
    assert.match((await get("/extra-permissions")).error, /permissions rejected/);
    const denied = (await get("/observed")).requests.slice(oldCount);
    assert.deepEqual(denied.map((r: any) => r.method), ["POST", "DELETE"]);
    for (const r of observed.requests) {
      assert.equal(r.redirect, "manual");
      assert.doesNotMatch(r.path, /merge|git\/refs|contents|actions/);
      if (r.path.endsWith("/access_tokens")) assert.deepEqual(r.body, { repositories: ["effect-ci-testbed"],
        permissions: { contents: "read", checks: "write", pull_requests: "write" } });
    }
    await get("/start");
    let completed;
    for (let i = 0; i < 200; i++) {
      const status = await get("/status");
      assert.notEqual(status.status, "errored", JSON.stringify(status.error));
      if (status.status === "complete") { completed = status.output; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(completed, "Native org policy did not complete");
    assert.equal(completed.decision.eligible, true);
    assert.equal(completed.reviewId, 3);
    assert.deepEqual(completed.workflowPlan.nodes.map((node: any) => node.id), ["inspect PR", "review", "approve PR"]);
    assert.ok(completed.workflowPlan.nodes.every((node: any) => node.status === "complete"));
    assert.equal((await get("/observed")).reviews.length, 3);
    for (const scenario of ["code", "nested", "rename", "mixed"]) {
      const normal = await get(`/${scenario}`);
      assert.equal(normal.state, "complete", JSON.stringify(normal));
      assert.equal(normal.decision.eligible, false);
      assert.equal(normal.reviewId, undefined);
    }
    const final = await get("/observed");
    assert.equal(final.reviews.length, 3, "Non-README changes never receive APPROVE");
    assert.ok(final.requests.every((r: any) => !r.path.endsWith("/pulls") && !/\/pulls\/\d+\/files/.test(r.path)),
      "The simple policy never reads author history");
    const requestsBeforeStale = (await get("/observed")).requests.length;
    assert.match((await get("/stale-policy")).error, /Org policy revision changed/);
    assert.match((await get("/stale-approval")).error, /Org policy revision changed/);
    assert.equal((await get("/observed")).requests.length, requestsBeforeStale,
      "Stale policy must not mint a token or read/write GitHub");
  } finally { await runtime.dispose(); }
});
