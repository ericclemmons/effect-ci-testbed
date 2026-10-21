import assert from "node:assert/strict";
import test from "node:test";
import { realpathSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { verifyExecutionReceipt } from "@effect-ci-testbed/cloudflare/execution-receipt";

test("the same hosted demo returns signed immutable observations of its actual native attempts", { timeout: 30000 }, async () => {
  const paths = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vite.config.ts", "tsconfig.json", "index.html", "src/app.ts", "src/message.ts", "src/message.test.ts", "packages/greeting/message.ts"].sort();
  const descriptor = { version: 1, uid: 1000, platform: "linux", arch: "x64", runtime: "v24.22.0", node: "c".repeat(64),
    dependencies: "d".repeat(64), dependencyFiles: 12, files: paths.map(path => {
      const bytes = readFileSync(new URL(`../../../examples/demo/${path}`, import.meta.url));
      return { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }) };
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject} from 'cloudflare:workers';
    import manifest from '../../../examples/demo/package.json';
    export {ShowcaseCIWorkflow} from './showcase-workflow.ts';
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    import {showcaseApi} from './showcase-api.ts';
    const commands=[];
    let failLint=false;
    let unavailable=false;
    export class WorkspaceContainer extends DurableObject {
      checkout(){} restore(){} stop(){} getCachedSnapshot(){} putCachedSnapshot(){}
      checkpoint(name){return{id:'PRIVATE-SNAPSHOT-'+name,name,size:1}}
      readFile(path){return path==='package.json'?JSON.stringify(manifest):''}
      exists(path){return path==='.'?!unavailable:path==='pnpm-lock.yaml'||path==='dist/index.html'}
      execute(command){commands.push(command);return{exitCode:failLint&&command==='pnpm lint'?7:0,
        stdout:command.includes('/inspect-check.cjs')?JSON.stringify(${JSON.stringify(descriptor)}):'',stderr:''}}
    }
    export default{async fetch(request,env,ctx){
      if(new URL(request.url).pathname.startsWith('/showcase/'))return showcaseApi.fetch(request,env,ctx);
      const p=await request.json();
      if(p.op==='fail'){failLint=true;return Response.json(true)}
      if(p.op==='reset'){failLint=false;return Response.json(true)}
      if(p.op==='unavailable'){unavailable=true;return Response.json(true)}
      if(p.op==='start'){await ctx.exports.ShowcaseCIWorkflow.create({id:p.id,params:{trigger:'remote',repository:'https://github.com/ericclemmons/effect-ci-testbed.git',revision:p.revision??'a'.repeat(40),targets:['lint']}});return Response.json(true)}
      if(p.op==='status')return Response.json(await(await ctx.exports.ShowcaseCIWorkflow.get(p.id)).status());
      return Response.json({commands});
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] });
  const runtime = new Miniflare({ workers: [{ config: { name: "showcase-execution-history", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, TrustedDemoChecks: { type: "durable-object", storage: "sqlite" },
      ShowcaseCIWorkflow: { type: "workflow", name: "showcase-execution-history" } },
    env: { EFFECT_CI_API_TOKEN: { type: "json", value: "fixture-only-api-token" },
      VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } } },
  } }] });
  const call = async (body: unknown): Promise<any> => (await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) })).json();
  const history = (revision: string, authorized = true) => runtime.dispatchFetch(`https://fixture.invalid/showcase/executions?revision=${revision}`,
    { headers: authorized ? { authorization: "Bearer fixture-only-api-token" } : {} });
  const run = async (id: string, revision?: string, failure = false) => {
    await call({ op: "start", id, ...(revision ? { revision } : {}) });
    for (let n = 0; n < 500; n++) {
      const status = await call({ op: "status", id });
      if (failure && status.status === "errored") return status;
      assert.notEqual(status.status, "errored", JSON.stringify(status.error));
      if (status.status === "complete") return status.output;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Native observation run did not complete");
  };
  try {
    assert.equal((await history("a".repeat(40), false)).status, 401);
    assert.equal((await history("main")).status, 400);
    const first = await run("first-observation");
    assert.equal(first.evidence.executions.receipts.length, 1);
    const original = JSON.stringify(first.evidence.executions.receipts[0]);
    const second = await run("second-observation");
    assert.equal(second.evidence.executions.receipts.length, 2);
    assert.ok(second.evidence.executions.receipts.some((receipt: unknown) => JSON.stringify(receipt) === original));
    const key = await crypto.subtle.importKey("jwk", second.evidence.executions.publicKey, "Ed25519", false, ["verify"]);
    for (const receipt of second.evidence.executions.receipts) {
      const verified = await verifyExecutionReceipt(JSON.stringify(receipt), receipt.claim.identity,
        new Map([[second.evidence.executions.keyId, key]]));
      assert.ok(verified);
      assert.equal(verified.identity.workflowId, "demo");
      assert.equal(verified.identity.revision, "a".repeat(40));
      assert.equal(verified.conclusion, "success");
      assert.equal(verified.attempt, 1);
      assert.ok(verified.steps.some(step => step.id === "lint" && step.status === "complete"));
      assert.ok(!JSON.stringify(receipt).includes("PRIVATE-SNAPSHOT"));
    }
    const other = await run("other-commit", "b".repeat(40));
    assert.equal(other.evidence.executions.receipts.length, 1);
    assert.equal(other.evidence.executions.receipts[0].claim.identity.revision, "b".repeat(40));
    const retained = await (await history("a".repeat(40))).json() as any;
    assert.equal(retained.receipts.length, 2, "one fixed existing authority partitions its immutable journal by source commit");
    assert.ok(retained.receipts.some((receipt: unknown) => JSON.stringify(receipt) === original));
    assert.equal((await call({ op: "inspect" })).commands.filter((command: string) => command === "pnpm lint").length, 3,
      "observation receipts are never mistaken for cache permission");
    assert.equal(JSON.stringify(first.evidence.executions.receipts[0]), original);
    await call({ op: "fail" });
    await run("failed-observation", undefined, true);
    const afterFailure = await (await history("a".repeat(40))).json() as any;
    assert.equal(afterFailure.receipts.length, 3);
    assert.ok(afterFailure.receipts.some((receipt: unknown) => JSON.stringify(receipt) === original));
    const failed = afterFailure.receipts.find((receipt: any) => receipt.claim.conclusion === "failure");
    assert.ok(failed, "a failed actual native attempt is retained through the same authenticated production API");
    const verifiedFailure = await verifyExecutionReceipt(JSON.stringify(failed), failed.claim.identity,
      new Map([[afterFailure.keyId, key]]));
    assert.ok(verifiedFailure?.steps.some(step => step.id === "lint" && step.status === "failed"));
    assert.ok(!JSON.stringify(afterFailure).includes("PRIVATE-SNAPSHOT"));
    assert.equal((await call({ op: "inspect" })).commands.filter((command: string) => command === "pnpm lint").length, 4,
      "history reads and recording failures never execute project commands");
    await call({ op: "reset" });
    const dispatch = async (targets: string[], rerunFrom?: string, failure = false, revision = "c".repeat(40)) => {
      const response = await runtime.dispatchFetch("https://fixture.invalid/showcase/runs", {
        method: "POST", headers: { authorization: "Bearer fixture-only-api-token" },
        body: JSON.stringify({ repository: "https://github.com/ericclemmons/effect-ci-testbed.git", revision,
          targets, ...(rerunFrom ? { rerunFrom } : {}) }),
      });
      assert.equal(response.status, 202, await response.clone().text());
      const { instanceId } = await response.json() as { instanceId: string };
      for (let n = 0; n < 500; n++) {
        const status = await call({ op: "status", id: instanceId });
        if (failure && status.status === "errored") return { instanceId, output: status };
        assert.notEqual(status.status, "errored", JSON.stringify(status.error));
        if (status.status === "complete") return { instanceId, output: status.output };
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail("Explicit compute rerun did not complete");
    };
    const compute = await dispatch(["build"]);
    const previous = JSON.stringify(compute.output.evidence.executions.receipts[0]);
    const beforeRerun = (await call({ op: "inspect" })).commands;
    const rerun = await dispatch(["test"], compute.instanceId);
    const later = (await call({ op: "inspect" })).commands.slice(beforeRerun.length);
    assert.equal(later.filter((command: string) => command === "pnpm lint").length, 0);
    assert.equal(later.filter((command: string) => command === "pnpm build").length, 1);
    assert.ok(!later.some((command: string) => command.includes("install --frozen-lockfile")), "prepared installation is restored, not repeated");
    assert.equal(rerun.output.evidence.executions.receipts.length, 2);
    assert.ok(rerun.output.evidence.executions.receipts.some((receipt: unknown) => JSON.stringify(receipt) === previous));
    const resumed = rerun.output.evidence.executions.receipts.find((receipt: any) => receipt.claim.instanceId === rerun.instanceId);
    assert.equal(resumed.claim.attempt, 2);
    assert.equal(resumed.claim.steps.find((step: any) => step.id === "install").status, "reused");
    assert.equal(resumed.claim.steps.find((step: any) => step.id === "test").status, "complete");
    assert.equal(resumed.claim.steps.find((step: any) => step.id === "build").status, "complete");
    assert.ok(!JSON.stringify(rerun.output).includes("PRIVATE-SNAPSHOT"));
    const commandCount = (await call({ op: "inspect" })).commands.length;
    await dispatch(["test"], "11111111-1111-4111-8111-111111111111", true);
    await dispatch(["test"], compute.instanceId, true, "d".repeat(40));
    await call({ op: "unavailable" });
    await dispatch(["test"], compute.instanceId, true);
    assert.equal((await call({ op: "inspect" })).commands.length, commandCount,
      "foreign attempts, changed commits and missing snapshots stop before project execution; none silently falls back to a fresh suite");
    const immutable = await (await history("c".repeat(40))).json() as any;
    assert.equal(immutable.receipts.length, 2);
    assert.ok(immutable.receipts.some((receipt: unknown) => JSON.stringify(receipt) === previous));
  } finally { await runtime.dispose(); }
});
