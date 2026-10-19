import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { testCommand, testFixedInputs, testPaths } from "@effect-ci-testbed/cloudflare/demo-test-check";
import { verifyRunnerCheckReceipt } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
const require = createRequire(import.meta.url);
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }));
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }));

test("native demo Workflow mints and later returns the same receipt without re-executing its test command", { timeout: 30_000 }, async () => {
  // Synthetic prepared inputs and a fake process executor. Real Workflow,
  // SQLite/RPC, CI orchestration and crypto; NOT a live Linux test-suite proof.
  const descriptor = { version: 1, platform: "linux", arch: "x64", runtime: "v24.22.0",
    node: "1".repeat(64), dependencies: "2".repeat(64), dependencyFiles: 1, versions: { node: "24.22.0" },
    files: testPaths.map(path => ({ path, size: 1, sha256: testFixedInputs[path] ?? "3".repeat(64) })) };
  const output = await build({ stdin: { contents: `
    import {DurableObject} from 'cloudflare:workers';
    import manifest from '../../../test/fixtures/demo/package.json';
    export {DemoCIWorkflow} from './demo-workflow.ts';
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    const commands=[];
    export class WorkspaceContainer extends DurableObject {
      checkout(){} restore(){} getCachedSnapshot(){} putCachedSnapshot(){}
      checkpoint(name){return {id:'fixture-'+name,name,size:1}}
      readFile(path){return path==='package.json'?JSON.stringify(manifest):undefined}
      exists(path){return path==='.'||path==='package-lock.json'}
      execute(command){commands.push(command);return {exitCode:0,stderr:'',stdout:command.includes('Untrusted runner uid')?${JSON.stringify(JSON.stringify(descriptor))}:'fixture process success'}}
    }
    export default {async fetch(request,env,ctx){
      const url=new URL(request.url),id=url.searchParams.get('id')||'first';
      if(url.pathname==='/start'){await ctx.exports.DemoCIWorkflow.create({id,params:{trigger:'remote',repository:'https://github.com/ericclemmons/effect-ci-testbed.git',revision:'a'.repeat(40),targets:['test']}});return Response.json({started:true})}
      if(url.pathname==='/status')return Response.json(await(await ctx.exports.DemoCIWorkflow.get(id)).status());
      return Response.json({commands});
    }};`, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "receipt-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", platform: "neutral",
    external: ["cloudflare:workers", "node:*"], conditions: ["workerd", "import"] });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "demo-receipts-probe", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
      TrustedDemoChecks: { type: "durable-object", storage: "sqlite" },
      DemoCIWorkflow: { type: "workflow", name: "demo-receipts-probe" } },
  } }] });
  const run = async (id: string) => {
    await runtime.dispatchFetch(`https://probe.invalid/start?id=${id}`);
    for (let attempt = 0; attempt < 200; attempt++) {
      const status = await (await runtime.dispatchFetch(`https://probe.invalid/status?id=${id}`)).json();
      assert.notEqual(status.status, "errored", JSON.stringify(status.error));
      if (status.status === "complete") return status.output;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail("Native receipt probe did not complete");
  };
  try {
    const first = await run("first"), second = await run("second");
    assert.equal(first.evidence.receipts.length, 1);
    const receipt = first.evidence.receipts[0];
    assert.equal(receipt.claim.runId, "first");
    assert.deepEqual(second.evidence, first.evidence);
    assert.equal(first.nodes.find((node: { id: string }) => node.id === "test").status, "complete");
    assert.equal(second.nodes.find((node: { id: string }) => node.id === "test").status, "verified");
    const state = await (await runtime.dispatchFetch("https://probe.invalid/state")).json();
    assert.equal(state.commands.filter((command: string) => command === testCommand).length, 1);
    assert.equal(state.commands.filter((command: string) => command.includes('npm run "typecheck"')).length, 2);
    const key = await crypto.subtle.importKey("jwk", first.evidence.publicKey, "Ed25519", false, ["verify"]);
    assert.equal(await verifyRunnerCheckReceipt(JSON.stringify(receipt), receipt.claim.identity,
      new Map([[first.evidence.keyId, key]])), true);
  } finally { await runtime.dispose(); }
});
