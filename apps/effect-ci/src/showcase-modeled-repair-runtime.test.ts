import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { showcaseTestCommand } from "./showcase-check-policy.ts";
import { verifyExecutionReceipt } from "@effect-ci-testbed/cloudflare/execution-receipt";

test("the same hosted app verifies its OFF-mode proposal independently while original CI remains failed", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import manifest from '../../../examples/demo/package.json';
    export {ShowcaseCIWorkflow} from './showcase-workflow.ts';
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    const snapshots=new Map(),commands=[],messages=[],github=[];let sequence=0,message=0,unknown=false,verificationFails=false;
    const blank='export const greeting = "";\\n',fixed='export const greeting = "Hello from a shared package.";\\n';
    export class WorkspaceContainer extends DurableObject {
      files={greeting:blank};
      materialize(snapshot){if(snapshot){const saved=snapshots.get(snapshot.id);if(!saved)throw Error('Missing snapshot');this.files={...saved}}}
      checkout(){this.files={greeting:blank}} restore(snapshot){this.materialize(snapshot)} stop(){} getCachedSnapshot(){} putCachedSnapshot(){}
      exists(path,_cwd,_step,snapshot){this.materialize(snapshot);return path==='.'||path==='pnpm-lock.yaml'}
      readFile(path,_cwd,_step,snapshot){this.materialize(snapshot);return path==='package.json'?JSON.stringify(manifest):path==='packages/greeting/message.ts'?this.files.greeting:undefined}
      checkpoint(name){const value={id:'PRIVATE-SNAPSHOT-'+(++sequence),name,size:1};snapshots.set(value.id,{...this.files});return value}
      execute(command,_cwd,step,snapshot){this.materialize(snapshot);commands.push({command,step,snapshot:snapshot?.id});
        if(command===${JSON.stringify(showcaseTestCommand)}){
          if(unknown)throw Error('PRIVATE PROVIDER TOKEN');
          if(this.files.greeting===blank){this.files.greeting='DIRTY FAILED PROCESS';return{exitCode:7,stdout:'original test log',stderr:'blank greeting'}}
          if(verificationFails)return{exitCode:9,stdout:'independent verification log',stderr:'candidate still fails'};
        }
        if(command.endsWith('/modeled-repair.cjs')){if(this.files.greeting!==blank)throw Error('Proposal did not start from the prepared immutable source');this.files.greeting=fixed}
        if(command.endsWith('/modeled-repair.cjs --verify')&&this.files.greeting!==fixed)return{exitCode:9,stdout:'',stderr:'candidate bytes differ'};
        return{exitCode:0,stdout:'completed',stderr:''};
      }
    }
    globalThis.fetch=async(input,init)=>{const url=new URL(String(input));
      if(url.hostname==='api.github.com'){
        if(url.pathname.endsWith('/access_tokens'))return Response.json({token:'fake-github-token'});
        const body=JSON.parse(init.body);github.push(body);return Response.json({id:1000+github.length,html_url:'https://github.com/example/check'});
      }
      if(url.pathname.endsWith('/chat.getPermalink'))return Response.json({ok:true,channel:'C1',permalink:'https://fixture.slack.com/archives/C1/p'+url.searchParams.get('message_ts').replace('.','')});
      const body=JSON.parse(init.body);messages.push(body);return Response.json({ok:true,ts:body.ts??String(++message)+'.000001'});
    };
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.op==='start'){unknown=p.unknown??false;verificationFails=p.verificationFails??false;commands.length=messages.length=github.length=0;message=0;
        await ctx.exports.ShowcaseCIWorkflow.create({id:p.id,params:{trigger:'github',repository:'https://github.com/ericclemmons/effect-ci-testbed.git',repositoryName:'ericclemmons/effect-ci-testbed',installationId:165265172,
          revision:'a'.repeat(40),ref:'refs/heads/demo/showcase-preview',deliveryId:p.id,summaryCheckId:999}});return Response.json(true)}
      if(p.op==='status')return Response.json(await(await ctx.exports.ShowcaseCIWorkflow.get(p.id)).status());
      if(p.op==='history')return Response.json(await ctx.exports.TrustedDemoChecks.getByName('showcase-trusted-runner-v1').executionHistory('a'.repeat(40)));
      return Response.json({commands,messages,github});
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const runtime = new Miniflare({ workers: [{ config: { name: "modeled-showcase-repair", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, TrustedDemoChecks: { type: "durable-object", storage: "sqlite" }, ShowcaseCIWorkflow: { type: "workflow", name: "modeled-showcase-repair" } },
    env: { VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } },
      SLACK_BOT_TOKEN: { type: "text", value: "fake-slack-token" }, SLACK_CHANNEL_ID: { type: "text", value: "C1" },
      GITHUB_APP_ID: { type: "text", value: "5089816" }, GITHUB_PRIVATE_KEY: { type: "text", value: privateKey } },
  } }] });
  const call = async (body: unknown): Promise<any> => (await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) })).json();
  try {
    for (const mode of ["known", "unknown", "verification-fails"]) {
      const unknown = mode === "unknown", verificationFails = mode === "verification-fails";
      const id = mode;
      await call({ op: "start", id, unknown, verificationFails });
      let status: any;
      for (let n = 0; n < 500; n++) {
        status = await call({ op: "status", id });
        if (status.status === "errored") break;
        assert.notEqual(status.status, "complete"); await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(status.status, "errored");
      assert.ok(status.error.message.includes(unknown ? "process exit unknown" : "Command failed (7)"), JSON.stringify(status.error));
      const state = await call({ op: "inspect" });
      const tests = state.commands.filter((command: any) => command.command === showcaseTestCommand);
      assert.equal(tests.length, unknown ? 1 : 2, "unknown results must not start a repair or repeat the test");
      const proposal = state.commands.find((command: any) => command.command.endsWith('/modeled-repair.cjs'));
      if (unknown) assert.equal(proposal, undefined);
      else {
        assert.ok(proposal, "known test failure reaches the same app's modeled proposal");
        assert.equal(proposal.snapshot, tests[0].snapshot, "start from immutable prepared input, not the dirty failed VM");
        assert.equal(tests[1].step, "verify repair");
        assert.notEqual(tests[1].snapshot, tests[0].snapshot);
        if (verificationFails) {
          assert.ok(!JSON.stringify(state.messages).includes("PR not created"), "failed verification cannot present a verified proposal");
          assert.ok(state.github.some((check: any) => check.conclusion === "failure" && check.name?.includes("demo-repair")));
        } else {
          assert.ok(JSON.stringify(state.messages).includes("Model OFF"));
          assert.ok(JSON.stringify(state.messages).includes("PR not created"));
          assert.ok(state.github.some((check: any) => check.conclusion === "success" && check.name?.includes("demo-repair")), "independent verification has a separate check purpose");
        }
      }
      assert.ok(state.github.some((check: any) => check.conclusion === "failure" && check.name?.includes("demo")));
      assert.ok(!JSON.stringify(state.messages).includes("PRIVATE-SNAPSHOT"));
      assert.ok(!JSON.stringify(state.messages).includes("PRIVATE PROVIDER TOKEN"));
    }
    const history = await call({ op: "history" });
    assert.equal(history.receipts.length, 5);
    const key = await crypto.subtle.importKey("jwk", history.publicKey, "Ed25519", false, ["verify"]);
    for (const receipt of history.receipts) assert.ok(await verifyExecutionReceipt(JSON.stringify(receipt), receipt.claim.identity,
      new Map([[history.keyId, key]])));
    assert.equal(history.receipts.filter((receipt: any) => receipt.claim.identity.workflowId === "demo" && receipt.claim.conclusion === "failure").length, 3);
    assert.equal(history.receipts.filter((receipt: any) => receipt.claim.identity.workflowId === "demo-repair" && receipt.claim.conclusion === "success").length, 1);
    assert.equal(history.receipts.filter((receipt: any) => receipt.claim.identity.workflowId === "demo-repair" && receipt.claim.conclusion === "failure").length, 1);
    assert.ok(!JSON.stringify(history).includes("PRIVATE-SNAPSHOT"));
  } finally { await runtime.dispose(); }
});
