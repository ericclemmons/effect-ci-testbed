import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const pluginPath = await realpath(
  new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
);
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }));
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }));
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

test(
  "real local Worker RPC/DO composition keeps verifier credentials out of simulated container files",
  { timeout: 60_000 },
  async () => {
    const output = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        contents: `
    import {DurableObject,WorkerEntrypoint} from "cloudflare:workers";
    export {RepairVerifier,OwnedRepairVerificationWorkflow} from "./repair-verifier.ts";
    import {FIXED_SOURCE,repairBlobHash,repairTreeHash} from "../../../packages/github/src/repair.ts";
    import {OWNED_BASE,OWNED_TEST,OWNED_PACKAGE,OWNED_NODE_COMMAND} from "../../../packages/github/src/repair-verifier.ts";
    const commit="bd9682e5b9ca5f8f696ea8052bd5afd4cd2c0a00",runId="friday-repair-20261013-1";let executed=0,revoked=0,tamper=false,files=null,check=null;
    const hex=b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,"0")).join("");
    globalThis.fetch=async(raw,init)=>{
      const url=new URL(String(raw));if(url.origin!=="https://api.github.com")throw new Error("Unexpected origin");
      if(url.pathname==="/app/installations/165265172/access_tokens"){
        const body=JSON.parse(init.body);
        if(JSON.stringify(body)!==JSON.stringify({repositories:["effect-ci-private-github-fixture"],permissions:{contents:"read",checks:"write"}}))throw new Error("Unsafe token");
        return Response.json({token:"local-host-secret",permissions:{contents:"read",checks:"write",metadata:"read"}});
      }
      if(url.pathname==="/installation/token"){revoked++;return new Response(null,{status:204})}
      if(init.redirect!=="manual")throw new Error("Unsafe redirect");
      const path=url.pathname.split("effect-ci-private-github-fixture")[1];
      const entries=await Promise.all([["health.js",FIXED_SOURCE],["health.test.mjs",OWNED_TEST],["package.json",OWNED_PACKAGE]].map(async([path,text])=>({path,mode:"100644",type:"blob",sha:await repairBlobHash(text)})));
      const directorySha=await repairTreeHash(entries),rootEntries=[{path:"repair-demo",mode:"040000",type:"tree",sha:directorySha}],rootSha=await repairTreeHash(rootEntries);
      if(path==="/git/trees/"+rootSha)return Response.json({sha:rootSha,truncated:false,tree:rootEntries});
      if(path==="/git/trees/"+directorySha)return Response.json({sha:directorySha,truncated:false,tree:entries});
      if(path==="/git/ref/heads/demo/friday-repair")return Response.json({ref:"refs/heads/demo/friday-repair",object:{type:"commit",sha:OWNED_BASE}});
      if(path==="/git/ref/heads/codex/repair-"+runId)return Response.json({ref:"refs/heads/codex/repair-"+runId,object:{type:"commit",sha:commit}});
      if(path==="/git/commits/"+commit)return Response.json({sha:commit,tree:{sha:rootSha},parents:[{sha:OWNED_BASE}],
        message:"Repair owned demo health status\\n\\nEffect-CI-Repair: "+runId+"\\nEffect-CI-Base: "+OWNED_BASE+"\\nEffect-CI-Patch-SHA256: "+hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(FIXED_SOURCE)))});
      if(path.startsWith("/contents/")){
        if(url.searchParams.get("ref")!==commit)throw new Error("Wrong revision");
        const name=path.slice("/contents/".length),text=name.endsWith("health.js")?FIXED_SOURCE:name.endsWith("health.test.mjs")?OWNED_TEST:OWNED_PACKAGE;
        return Response.json({path:name,type:"file",sha:await repairBlobHash(text),encoding:"base64",content:btoa(tamper?"changed test":text)});
      }
      if(path==="/commits/"+commit+"/check-runs")return Response.json({total_count:check?1:0,check_runs:check?[check]:[]});
      if(path==="/check-runs"&&init.method==="POST"){check={...JSON.parse(init.body),id:123,app:{id:5089816}};return Response.json(check)}
      throw new Error("Unexpected request");
    };
    // Actual DO RPC surface, but FAKE execution. This is not native Node evidence.
    export class WorkspaceContainer extends DurableObject {
      materializeSource(value,options){
        if(value.length!==3||JSON.stringify(value).includes("local-host-secret")||options.image!=="workspace")throw new Error("Unsafe materialization");
        files=value;
      }
      execute(command,cwd,step,revision,cachePaths,cacheRoot,options){
        if(command!==OWNED_NODE_COMMAND||cwd!=="/workspace/repository"||step!=="owned-repair-node"||revision!==undefined||cachePaths.length||options.image!=="workspace"||!files)throw new Error("Unsafe execution");
        executed++;return {exitCode:0,stdout:"fake bounded output",stderr:""};
      }
    }
    export default class Driver extends WorkerEntrypoint {
      async fetch(request){
        const capability=this.ctx.exports.RepairVerifier({});
        if(new URL(request.url).pathname==="/public")return capability.fetch(request);
        if(new URL(request.url).pathname==="/pilot"){await this.ctx.exports.OwnedRepairVerificationWorkflow.create({id:"owned-local-pilot",params:{mode:"verify-retained"}});return Response.json({started:true})}
        if(new URL(request.url).pathname==="/status")return Response.json(await (await this.ctx.exports.OwnedRepairVerificationWorkflow.get("owned-local-pilot")).status());
        tamper=new URL(request.url).pathname==="/tamper";
        let result=null,rejected=false;
        try{const original=await capability.verify(commit,runId);result={commit:original.commit,sourceDigest:original.sourceDigest,passed:original.passed,evidenceId:original.evidenceId}}
        catch{rejected=true}
        return Response.json({result,rejected,executed,revoked,files});
      }
    }
  `,
      },
      bundle: true,
      platform: "neutral",
      format: "esm",
      target: "es2022",
      write: false,
      external: ["cloudflare:workers", "node:*"],
      conditions: ["workerd", "import"],
      packages: "bundle",
    });
    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: "owned-native-verifier-local",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } },
            },
            exports: {
              RepairVerifier: { type: "worker" },
              WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
              OwnedRepairVerificationWorkflow: {
                type: "workflow",
                name: "owned-local-verification",
              },
            },
            env: {
              GITHUB_APP_ID: { type: "json", value: "5089816" },
              GITHUB_PRIVATE_KEY: { type: "json", value: privateKey },
            },
          },
        },
      ],
    });
    try {
      const publicResponse = await mf.dispatchFetch("https://owned.test/public");
      assert.equal(publicResponse.status, 404, await publicResponse.clone().text());
      const value = await (await mf.dispatchFetch("https://owned.test/verify")).json();
      assert.equal(value.rejected, false);
      assert.equal(value.result.passed, true);
      assert.equal(value.result.evidenceId, "github_check_123");
      assert.equal(value.executed, 1);
      assert.equal(value.revoked, 1);
      assert.equal(value.files.length, 3);
      assert.ok(!JSON.stringify(value).includes("local-host-secret"));
      assert.ok(!JSON.stringify(value).includes(privateKey));
      assert.equal((await mf.dispatchFetch("https://owned.test/pilot")).status, 200);
      let completed = false;
      for (let i = 0; i < 200; i++) {
        const status = await (await mf.dispatchFetch("https://owned.test/status")).json();
        assert.notEqual(status.status, "errored", JSON.stringify(status.error));
        if (status.status === "complete") {
          assert.equal(status.output.environment, "native-node-container");
          assert.equal(status.output.commandExecuted, true);
          assert.equal(status.output.codeWritten, false);
          assert.equal(status.output.pullRequestCreated, false);
          assert.equal(status.output.deploymentPerformed, false);
          assert.equal(status.output.evidenceId, "github_check_123");
          completed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(
        completed,
        true,
        "actual local Workflow checkpoint serializes plain receipt fields",
      );
      const denied = await (await mf.dispatchFetch("https://owned.test/tamper")).json();
      assert.equal(denied.rejected, true);
      assert.equal(denied.executed, 2);
      assert.equal(denied.revoked, 3);
    } finally {
      await mf.dispose();
    }
  },
);
