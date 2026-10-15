import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

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
      import {DurableObject} from "cloudflare:workers";
      import manifest from "../../../examples/demo/package.json";
      export {DemoCIWorkflow} from "./demo-workflow.ts";
      const reads=[],exists=[],commands=[];let missingLock=false;
      const cwd="/workspace/repository/examples/demo";
      export class WorkspaceContainer extends DurableObject {
        async checkout(){}
        async restore(){}
        async getCachedSnapshot(){return undefined}
        async putCachedSnapshot(){}
        async checkpoint(name){return {id:"fixture-"+name,name,size:1}}
        async readFile(path,root){
          if(root!==cwd&&root!=="/workspace/repository")throw new Error("Wrong remote root: "+root);
          reads.push({path,root});
          return path==="package.json"?JSON.stringify(manifest):undefined;
        }
        async exists(path,root){
          if(root!==cwd)throw new Error("Wrong package root");
          exists.push(path);return !missingLock&&path==="package-lock.json";
        }
        async execute(command,root){
          if(root!==cwd)throw new Error("Wrong command root");
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
        if(path==="/status")return Response.json(await (await ctx.exports.DemoCIWorkflow.get(new URL(request.url).searchParams.has("missing")?"demo-missing-lock":"demo-filesystem")).status());
        return Response.json({reads,exists,commands});
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
      assert.ok(
        state.reads.some(
          (read: { path: string; root: string }) =>
            read.path === "package.json" && read.root.endsWith("/examples/demo"),
        ),
      );
      assert.ok(state.exists.includes("package-lock.json"));
      assert.deepEqual(state.commands, [
        "npm_config_cache=.effect-ci/cache/npm npm ci",
        'npm run "lint"',
        'npm run "check"',
        'npm run "typecheck"',
        'npm run "test"',
        'npm run "build"',
      ]);
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
      assert.equal(after.commands.length, 6, "missing lockfile must fail before any extra command");
    } finally {
      await runtime.dispose();
    }
  },
);
