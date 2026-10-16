import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

test(
  "real local incident SQLite writer/Workflow/RPC persists one distinct operation across reload, with fake GitHub and verifier",
  { timeout: 60_000 },
  async () => {
    const output = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        contents: `
    import {WorkerEntrypoint} from "cloudflare:workers";
    export {OwnedIncidentRepairOperations,IncidentRepairWriter,OwnedIncidentRepairWorkflow} from "./incident-repair-writer.ts";
    import {FIXED_SOURCE,BROKEN_SOURCE,REPAIR_REPOSITORY,repairBlobHash,repairTreeHash} from "../../../packages/github/src/repair.ts";
    import {OWNED_BASE,OWNED_TEST,OWNED_PACKAGE} from "../../../packages/github/src/repair-verifier.ts";
    import {INCIDENT_REPAIR_RUN} from "../../../packages/github/src/incident-repair-operation.ts";
    const candidate="c".repeat(40);let branch=null,pr=null,message="",posts=0,revoked=0,verified=0;
    const hex=b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,"0")).join("");
    const sourceDigest=async()=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(FIXED_SOURCE)));
    // Trusted fake verifier capability; NOT actual native Node evidence.
    export class RepairVerifier extends WorkerEntrypoint {
      async verify(commit,run){if(commit!==candidate||run!==INCIDENT_REPAIR_RUN||branch!==candidate)throw new Error("Wrong verification identity");verified++;
        return {commit,sourceDigest:await sourceDigest(),passed:true,evidenceId:"github_check_123"}}
      fetch(){return new Response("Not found",{status:404})}
    }
    globalThis.fetch=async(raw,init)=>{
      const url=new URL(String(raw)),body=init?.body?JSON.parse(init.body):undefined;
      if(url.origin!=="https://api.github.com")throw new Error("Unexpected origin");
      if(url.pathname==="/app/installations/165265172/access_tokens"){
        if(JSON.stringify(body)!==JSON.stringify({repositories:["effect-ci-private-github-fixture"],permissions:{contents:"write",pull_requests:"write"}}))throw new Error("Unsafe token");
        return Response.json({token:"fake-private-writer",permissions:{contents:"write",pull_requests:"write",metadata:"read"}});
      }
      if(url.pathname==="/installation/token"){revoked++;return new Response(null,{status:204})}
      if(init.redirect!=="manual")throw new Error("Unsafe redirect");
      const path=url.pathname.slice(('/repos/'+REPAIR_REPOSITORY).length);
      const oldBlob=await repairBlobHash(BROKEN_SOURCE),nextBlob=await repairBlobHash(FIXED_SOURCE);
      const oldDir=await Promise.all([["health.js",BROKEN_SOURCE],["health.test.mjs",OWNED_TEST],["package.json",OWNED_PACKAGE]].map(async([path,text])=>({path,mode:"100644",type:"blob",sha:await repairBlobHash(text)})));
      const oldDirId=await repairTreeHash(oldDir),nextDirId=await repairTreeHash(oldDir.map(e=>e.path==="health.js"?{...e,sha:nextBlob}:e));
      const oldRoot=[{path:"repair-demo",mode:"040000",type:"tree",sha:oldDirId}],oldRootId=await repairTreeHash(oldRoot);
      const nextRootId=await repairTreeHash([{...oldRoot[0],sha:nextDirId}]);
      const ref=(name,sha)=>Response.json({ref:"refs/heads/"+name,object:{type:"commit",sha}});
      if(path==="/git/ref/heads/demo/friday-repair")return ref("demo/friday-repair",OWNED_BASE);
      if(path==="/git/ref/heads/codex/repair-"+INCIDENT_REPAIR_RUN)return branch?ref("codex/repair-"+INCIDENT_REPAIR_RUN,branch):new Response(null,{status:404});
      if(path==="/git/commits/"+OWNED_BASE)return Response.json({sha:OWNED_BASE,tree:{sha:oldRootId}});
      if(path==="/git/trees/"+oldRootId)return Response.json({sha:oldRootId,truncated:false,tree:oldRoot});
      if(path==="/git/trees/"+oldDirId)return Response.json({sha:oldDirId,truncated:false,tree:oldDir});
      if(path==="/git/blobs/"+oldBlob)return Response.json({sha:oldBlob,encoding:"base64",content:btoa(BROKEN_SOURCE)});
      if(init.method==="POST")posts++;
      if(path==="/git/blobs"){if(body.content!==FIXED_SOURCE)throw new Error("Unsafe patch");return Response.json({sha:nextBlob})}
      if(path==="/git/trees"){if(body.base_tree!==oldRootId||body.tree.length!==1||body.tree[0].path!=="repair-demo/health.js"||body.tree[0].sha!==nextBlob)throw new Error("Unsafe tree");return Response.json({sha:nextRootId})}
      if(path==="/git/commits"){if(body.tree!==nextRootId||body.parents.length!==1||body.parents[0]!==OWNED_BASE)throw new Error("Unsafe commit");message=body.message;return Response.json({sha:candidate})}
      if(path==="/git/refs"){if(branch||body.ref!=="refs/heads/codex/repair-"+INCIDENT_REPAIR_RUN||body.sha!==candidate)throw new Error("Unsafe ref");branch=candidate;return ref("codex/repair-"+INCIDENT_REPAIR_RUN,candidate)}
      if(path==="/git/commits/"+candidate)return Response.json({sha:candidate,tree:{sha:nextRootId},parents:[{sha:OWNED_BASE}],message});
      if(path==="/pulls"&&init.method==="GET")return Response.json(pr?[pr]:[]);
      if(path==="/pulls"&&init.method==="POST"){
        if(pr||verified!==1||body.base!=="demo/friday-repair"||body.head!=="codex/repair-"+INCIDENT_REPAIR_RUN)throw new Error("PR before verification or duplicate");
        pr={number:3,state:"open",title:body.title,body:body.body,user:{login:"effect-ci[bot]",id:334321206,type:"Bot"},head:{ref:body.head,sha:candidate},base:{ref:body.base}};return Response.json(pr);
      }
      throw new Error("Unexpected fixed API path");
    };
    export default class Driver extends WorkerEntrypoint {
      async fetch(request){
        const writer=this.ctx.exports.IncidentRepairWriter({}),path=new URL(request.url).pathname;
        if(path==="/public")return writer.fetch(request);
        if(path==="/bad-evidence"){
          await this.env.INCIDENT_EVIDENCE.invalid(true);
          let rejected=false;try{await writer.proposeIncident()}catch{rejected=true}
          await this.env.INCIDENT_EVIDENCE.invalid(false);
          return Response.json({rejected});
        }
        if(path==="/start"){await this.ctx.exports.OwnedIncidentRepairWorkflow.create({id:"owned-writer-local",params:{mode:"propose-incident"}});return Response.json({started:true})}
        if(path==="/status")return Response.json(await (await this.ctx.exports.OwnedIncidentRepairWorkflow.get("owned-writer-local")).status());
        if(path==="/replay"){const r=await writer.proposeIncident();return Response.json({replay:r.replay,created:r.created,url:r.url,evidenceId:r.evidenceId})}
        const state=await writer.inspectIncident();return Response.json({state:{state:state.state,runId:state.runId},posts,revoked,verified,pr,reads:await this.env.INCIDENT_EVIDENCE.count()});
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
    });
    const evidenceCode = `import {WorkerEntrypoint} from "cloudflare:workers";let reads=0,bad=false;export class FakeEvidence extends WorkerEntrypoint {
    invalid(value){bad=value}
    readIncident(){if(this.env.GITHUB_PRIVATE_KEY)throw new Error("App credential reached evidence service");reads++;return {instance:"owned-issue-flue-e28e6b86-v1",reservationId:"flue_54c540e5b12e62cae83001008487f8a26b1652a7664fb511a576e045f8e47c87",run:"friday-flue-proposal-v1",text:"export function healthStatus() { return 200; }",issueId:bad?"foreign":"e28e6b86-bea4-440f-8729-be6437e97293",operationId:"owned-issue:e28e6b86-bea4-440f-8729-be6437e97293",activationPolicy:"host-owned-incident-proposal-only-v1"}}
    count(){return reads}fetch(){return new Response("Not found",{status:404})}}
    export default {fetch(){return new Response("Not found",{status:404})}};`;
    const options = (suffix = "") => ({
      workers: [
        {
          config: {
            name: "owned-writer-local",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: {
                "index.js": { type: "esm", contents: output.outputFiles[0].text + suffix },
              },
            },
            exports: {
              OwnedIncidentRepairOperations: { type: "durable-object", storage: "sqlite" },
              IncidentRepairWriter: { type: "worker" },
              RepairVerifier: { type: "worker" },
              OwnedIncidentRepairWorkflow: {
                type: "workflow",
                name: "local-native-repair-proposal",
              },
            },
            env: {
              GITHUB_APP_ID: { type: "json", value: "5089816" },
              GITHUB_PRIVATE_KEY: { type: "json", value: privateKey },
              INCIDENT_EVIDENCE: {
                type: "worker",
                worker: "evidence-local",
                exportName: "FakeEvidence",
              },
            },
          },
        },
        {
          config: {
            name: "evidence-local",
            compatibilityDate: "2026-10-07",
            exports: { FakeEvidence: { type: "worker" } },
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: evidenceCode } },
            },
          },
        },
      ],
    });
    const runtime = new Miniflare(options());
    try {
      assert.equal((await runtime.dispatchFetch("https://owned.test/public")).status, 404);
      const before = await (await runtime.dispatchFetch("https://owned.test/state")).json();
      assert.equal(before.state.state, "absent");
      assert.deepEqual(await (await runtime.dispatchFetch("https://owned.test/bad-evidence")).json(), { rejected: true });
      const invalid = await (await runtime.dispatchFetch("https://owned.test/state")).json();
      assert.equal(invalid.state.state, "absent");
      assert.equal(invalid.posts, 0);
      assert.equal((await runtime.dispatchFetch("https://owned.test/start")).status, 200);
      let completed: any;
      for (let i = 0; i < 200; i++) {
        const status = await (await runtime.dispatchFetch("https://owned.test/status")).json();
        assert.notEqual(status.status, "errored", JSON.stringify(status.error));
        if (status.status === "complete") {
          completed = status.output;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(completed?.pullRequest, 3);
      assert.equal(completed.created, true);
      assert.equal(completed.replay, false);
      assert.equal(completed.issueId, "e28e6b86-bea4-440f-8729-be6437e97293");
      assert.equal(completed.automaticWebhookActivation, false);
      const state = await (await runtime.dispatchFetch("https://owned.test/state")).json();
      assert.equal(state.posts, 5);
      assert.equal(state.revoked, 1);
      assert.equal(state.verified, 1);
      assert.equal(state.reads, 2);
      assert.equal(state.state.state, "complete");
      const replay = await (await runtime.dispatchFetch("https://owned.test/replay")).json();
      assert.equal(replay.replay, true);
      assert.equal(replay.created, false);
      assert.equal(
        (await (await runtime.dispatchFetch("https://owned.test/state")).json()).posts,
        5,
      );
      await runtime.setOptions(options("\n// reload owned writer isolate\n"));
      const after = await (await runtime.dispatchFetch("https://owned.test/replay")).json();
      assert.deepEqual(
        after,
        replay,
        "completed SQLite receipt survives reload without GitHub/evidence writes",
      );
      const reloaded = await (await runtime.dispatchFetch("https://owned.test/state")).json();
      assert.equal(reloaded.posts, 0);
      assert.equal(reloaded.revoked, 0);
      assert.equal(reloaded.verified, 0);
      assert.equal(reloaded.reads, 0, "reloaded fake evidence isolate receives no new read");
    } finally {
      await runtime.dispose();
    }
  },
);
