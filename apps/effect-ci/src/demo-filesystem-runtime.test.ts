import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import {
  syntaxCommand,
  syntaxInspectCommand,
} from "@effect-ci-testbed/cloudflare/node-syntax-check";

const require = createRequire(import.meta.url);
const pluginPath = await realpath(
  new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
);
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }));
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }));

test(
  "actual hosted wrapper discovers package manager through the remote runner filesystem",
  { timeout: 30_000 },
  async () => {
    const output = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        sourcefile: "demo-filesystem-probe.ts",
        loader: "ts",
        contents: `
      import {DurableObject,WorkerEntrypoint} from "cloudflare:workers";
      import {demoSite,demoSiteUrl} from '@effect-ci-testbed/cloudflare/demo-site';
      import {demoCandidatePolicy} from '@effect-ci-testbed/cloudflare/demo-candidate';
      import manifest from "../../../examples/demo/package.json";
      export {DemoCIWorkflow} from "./demo-workflow.ts";
      import {workflowEntrypoint} from '@effect-ci-testbed/github-cloudflare';
      import {makeDemoProgram} from './demo-program.ts';
      // TEST-ONLY host for candidate diagnostics. Remote DemoCIWorkflow must
      // never prepare a production candidate, including when this broker fails.
      export const PrepareFailureWorkflow=workflowEntrypoint((env,p)=>makeDemoProgram({revision:p.revision,
        publish:files=>env.DEMO_SITE.publish(p.revision,files),
        prepare:(revision,digest)=>env.RELEASE_MANAGER.prepareCandidate(revision,digest)}).workflow,
        {root:'examples/demo',cache:false});
      const reads=[],exists=[],commands=[],snapshots=[],restores=[],publications=[];let missingLock=false,cacheReads=0,prepareFailure=false,publicationFailure=false,prepareCalls=0;
      const assets={'index.html':'<h1>actual fixture</h1>','app.js':'export const x=1','message.js':'export const message="hello"'};
      export class Publisher extends WorkerEntrypoint {
        async publish(revision,files){if(publicationFailure)throw Error('Bearer fake-publication-secret');publications.push({revision,files});const site=await demoSite(revision,files);return {revision,digest:site.digest,url:demoSiteUrl(site)};}
        async prepareCandidate(revision,digest){prepareCalls++;if(prepareFailure)throw Error('Candidate upload uncertain or rejected (identity, HTTP 200, version 11111111-1111-4111-8111-111111111111); reconcile the pending identity, never retry automatically');return {revision,digest,moduleDigest:'b'.repeat(64),policy:demoCandidatePolicy,version:'11111111-1111-4111-8111-111111111111',script:'effect-ci-hmd-demo'};}
      }
      const cwd="/workspace/repository/examples/demo";
      export class WorkspaceContainer extends DurableObject {
        async checkout(){}
        async restore(snapshot){restores.push(snapshot.id);}
        async getCachedSnapshot(){cacheReads++;return undefined}
        async putCachedSnapshot(){}
        async checkpoint(name){const value={id:"fixture-"+name,name,size:1};snapshots.push(value);return value;}
        async readFile(path,root){
          if(root!==cwd&&root!=="/workspace/repository")throw new Error("Wrong remote root: "+root);
          reads.push({path,root});
          return path==="package.json"?JSON.stringify(manifest):path.startsWith('dist/')?assets[path.slice(5)]:undefined;
        }
        async exists(path,root){
          if(root!==cwd)throw new Error("Wrong package root");
          exists.push(path);return path==='.'||(!missingLock&&path==="package-lock.json");
        }
        async execute(command,root,_step,revision){
          if(root!==cwd)throw new Error("Wrong command root");
          if(command.endsWith('verify-build.ts')&&revision?.id!=='fixture-build-workspace')throw Error('Consumer did not inherit the completed build revision');
          commands.push(command);return {exitCode:0,stdout:"fixture execution",stderr:""};
        }
      }
      export default {async fetch(request,env,ctx){
        const path=new URL(request.url).pathname;
        if(path==="/start"){
          await ctx.exports.DemoCIWorkflow.create({id:"demo-filesystem",params:{trigger:"remote",repository:"https://github.com/ericclemmons/effect-ci-testbed.git",revision:"a".repeat(40)}});
          return Response.json({started:true});
        }
        if(path==="/missing"){
          missingLock=true;
          await ctx.exports.DemoCIWorkflow.create({id:"demo-missing-lock",params:{trigger:"remote",repository:"https://github.com/ericclemmons/effect-ci-testbed.git",revision:"a".repeat(40)}});
          return Response.json({started:true});
        }
        if(path==="/prepare-failure"){
          missingLock=false;prepareFailure=true;
          await ctx.exports.PrepareFailureWorkflow.create({id:"demo-prepare-failure",params:{trigger:"remote",repository:"https://github.com/ericclemmons/effect-ci-testbed.git",revision:"a".repeat(40)}});
          return Response.json({started:true});
        }
        if(path==="/publication-failure"){
          missingLock=false;publicationFailure=true;
          await ctx.exports.DemoCIWorkflow.create({id:"demo-publication-failure",params:{trigger:"remote",repository:"https://github.com/ericclemmons/effect-ci-testbed.git",revision:"a".repeat(40)}});
          return Response.json({started:true});
        }
        if(path==="/status"){const prepare=new URL(request.url).searchParams.has('prepare');return Response.json(await (await (prepare?ctx.exports.PrepareFailureWorkflow:ctx.exports.DemoCIWorkflow).get(new URL(request.url).searchParams.has("publication")?"demo-publication-failure":prepare?"demo-prepare-failure":new URL(request.url).searchParams.has("missing")?"demo-missing-lock":"demo-filesystem")).status());}
        return Response.json({reads,exists,commands,cacheReads,snapshots,restores,publications,prepareCalls});
      }};
    `,
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "esnext",
      write: false,
      external: ["cloudflare:workers", "node:*"],
      conditions: ["workerd", "import"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "demo-filesystem-probe",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } },
            },
            exports: {
              WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
              DemoCIWorkflow: { type: "workflow", name: "demo-filesystem-probe" },
              PrepareFailureWorkflow: { type: "workflow", name: "demo-prepare-failure-probe" },
              Publisher: { type: "worker" },
            },
            env: {
              RELEASE_MANAGER: {
                type: "worker",
                worker: "demo-filesystem-probe",
                exportName: "Publisher",
              },
              DEMO_SITE: {
                type: "worker",
                worker: "demo-filesystem-probe",
                exportName: "Publisher",
              },
            },
          },
        },
      ],
    });
    try {
      assert.equal((await runtime.dispatchFetch("https://probe.invalid/start")).status, 200);
      let output: any;
      for (let i = 0; i < 200; i++) {
        const status = await (await runtime.dispatchFetch("https://probe.invalid/status")).json();
        assert.notEqual(status.status, "errored", JSON.stringify(status.error));
        if (status.status === "complete") {
          output = status.output;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(output?.workflowId, "cf-ci-demo");
      const state = await (await runtime.dispatchFetch("https://probe.invalid/state")).json();
      assert.equal(
        state.cacheReads,
        0,
        "attested source must not restore a project-modified image snapshot",
      );
      assert.ok(
        state.reads.some(
          (read: { path: string; root: string }) =>
            read.path === "package.json" && read.root.endsWith("/examples/demo"),
        ),
      );
      assert.ok(state.exists.includes("package-lock.json"));
      assert.deepEqual(state.commands, [
        syntaxInspectCommand,
        syntaxCommand,
        "npm_config_cache=.effect-ci/cache/npm npm ci",
        'npm run "lint"',
        'npm run "check"',
        'npm run "typecheck"',
        'npm run "test"',
        'npm run "build"',
        "node .cloudflare/ci/verify-build.ts",
      ]);
      assert.equal(output.nodes.length, 10);
      assert.equal(state.publications.length, 1);
      assert.equal(state.publications[0].revision, "a".repeat(40));
      assert.equal(output.nodes.at(-1).id, "publish site");
      assert.equal(state.prepareCalls, 0, "remote CLI has no production candidate authority");
      assert.ok(state.snapshots.some((snapshot: any) => snapshot.name === "build-workspace"));
      assert.ok(
        state.snapshots.some((snapshot: any) => snapshot.name === "verify build-workspace"),
      );
      assert.equal(state.restores.length, 0, "normal dependencies need no explicit restore");
      assert.ok(output.nodes.every((node: any) => node.artifacts.length === 0));
      assert.ok(output.nodes.every((node: { status: string }) => node.status === "complete"));
      await runtime.dispatchFetch("https://probe.invalid/missing");
      let failed: any;
      for (let i = 0; i < 200; i++) {
        const status = await (
          await runtime.dispatchFetch("https://probe.invalid/status?missing=1")
        ).json();
        if (status.status === "errored") {
          failed = status;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.match(failed?.error?.message ?? "", /Could not detect a JavaScript package manager/);
      const after = await (await runtime.dispatchFetch("https://probe.invalid/state")).json();
      assert.equal(
        after.commands.length,
        11,
        "missing lockfile must fail before any extra package command",
      );
      await runtime.dispatchFetch("https://probe.invalid/prepare-failure");
      let prepareFailed: any;
      for (let i = 0; i < 200; i++) {
        const status = await (await runtime.dispatchFetch("https://probe.invalid/status?prepare=1")).json();
        if (status.status === "errored") { prepareFailed = status; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.match(prepareFailed?.error?.message ?? "", /stage=identity/);
      assert.match(prepareFailed.error.message, /HTTP 200/);
      assert.match(prepareFailed.error.message, /never retry automatically/);
      await runtime.dispatchFetch("https://probe.invalid/publication-failure");
      let publicationFailed: any;
      for (let i = 0; i < 200; i++) {
        const status = await (await runtime.dispatchFetch("https://probe.invalid/status?publication=1")).json();
        if (status.status === "errored") { publicationFailed = status; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.match(publicationFailed?.error?.message ?? "", /stage=publication/);
      assert.doesNotMatch(JSON.stringify(publicationFailed), /fake-publication-secret/);
    } finally {
      await runtime.dispose();
    }
  },
);
