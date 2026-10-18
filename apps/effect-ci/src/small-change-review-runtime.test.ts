import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }));
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }));

test("native SQLite reviewer consumes host-verified receipts, journals one approval and reconciles its lost ACK", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "review-probe.ts", loader: "ts", contents: `
    import {SmallChangeReviews,withSmallChangeToken} from './small-change-review.ts';
    import {demoRunnerPolicyDigest,demoBuildIdentity} from './demo-runner-policy.ts';
    import {syntaxRepository,syntaxWorkflow} from '@effect-ci-testbed/cloudflare/node-syntax-check';
    import {testCommand} from '@effect-ci-testbed/cloudflare/demo-test-check';
    export {SmallChangeReviews};
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    const head='a'.repeat(40),base='b'.repeat(40),repo='ericclemmons/effect-ci-testbed';
    const checks=[],reviews=[],requests=[];let failReview=false,extraPermissions=false,renamed=false;
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
      if(/^\\/pulls\\/(50|51)$/.test(path))return Response.json({number:Number(path.split('/').at(-1)),base:{sha:base,repo:{full_name:repo}},head:{sha:head,repo:{full_name:repo}},user:{id:7},changed_files:1,state:'open',draft:false});
      if(/^\\/pulls\\/(50|51)\\/files$/.test(path))return Response.json([{filename:'README.md',status:'modified',additions:1,deletions:1,patch:'-old\\n+new'}]);
      if(path==='/pulls')return Response.json(Array.from({length:10},(_,i)=>({number:i+1,merged_at:'2026-10-18T00:00:00Z',user:{id:7},base:{repo:{full_name:repo}}})));
      if(/^\\/pulls\\/\\d+\\/files$/.test(path))return Response.json([{filename:'README.md'}]);
      if(path.startsWith('/commits/'))return Response.json({total_count:checks.length,check_runs:checks});
      if(path.endsWith('/reviews'))return Response.json(reviews);
      throw Error('Unexpected fixture request '+path);
    };
    export default {async fetch(request,env,ctx){
      const path=new URL(request.url).pathname;
      const owner=n=>ctx.exports.SmallChangeReviews.getByName('pr-'+n);
      try{
        if(path==='/seed'){
          const authority=ctx.exports.TrustedDemoChecks.getByName('demo-trusted-runner-v1');
          await authority.record({identity:{kind:'check',repository:syntaxRepository,revision:head,workflowId:syntaxWorkflow,stepId:'test',command:testCommand,policyDigest:await demoRunnerPolicyDigest(true),sourceDigest:'c'.repeat(64),toolchainDigest:'d'.repeat(64)},runId:'fixture-execution',completedAt:'2026-10-18T00:00:00.000Z',exitCode:0,stdoutDigest:'e'.repeat(64),stderrDigest:'f'.repeat(64)});
          await authority.recordStepResult({identity:await demoBuildIdentity(head,env.VERSION_METADATA.id),runId:'fixture-build',completedAt:'2026-10-18T00:00:00.000Z',conclusion:'success',result:{kind:'workspace',provider:'cloudflare-container',cwd:'/workspace/repository/examples/demo',snapshot:{id:'fixture-snapshot',size:100}}});
          return Response.json({seeded:true});
        }
        if(path==='/lost'){failReview=true;return Response.json(await owner(51).evaluate(51))}
        if(path==='/reconcile'){renamed=true;for(const review of reviews)review.user.login='cleaner-name[bot]';return Response.json(await owner(51).evaluate(51))}
        if(path==='/extra-permissions'){extraPermissions=true;try{await withSmallChangeToken(env,()=>{throw Error('Must not run operation')})}finally{extraPermissions=false} }
        if(path==='/review')return Response.json(await owner(50).evaluate(50));
        return Response.json({checks,reviews,requests});
      }catch(error){return Response.json({error:String(error)}, {status:500})}
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers"] });
  const name = "small-change-native-probe";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { SmallChangeReviews: { type: "durable-object", storage: "sqlite" }, TrustedDemoChecks: { type: "durable-object", storage: "sqlite" } },
    env: { GITHUB_APP_ID: { type: "text", value: "5089816" },
      GITHUB_PRIVATE_KEY: { type: "text", value: privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } } },
  } }] });
  const get = async (path: string) => (await runtime.dispatchFetch(`https://probe.invalid${path}`)).json();
  try {
    const missing = await get("/review");
    assert.equal(missing.decision.eligible, false);
    assert.equal((await get("/observed")).reviews.length, 0);
    await get("/seed");
    const first = await get("/review"), replay = await get("/review");
    assert.equal(first.state, "complete"); assert.equal(first.decision.eligible, true); assert.deepEqual(replay, first);
    let observed = await get("/observed");
    assert.equal(observed.reviews.length, 1);
    assert.equal(observed.checks.length, 2); // earlier normal-review result retained
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
  } finally { await runtime.dispose(); }
});
