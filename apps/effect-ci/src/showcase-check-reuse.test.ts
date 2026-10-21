import assert from "node:assert/strict";
import test from "node:test";
import { realpath, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash, generateKeyPairSync } from "node:crypto";
import { verifyRunnerCheckReceipt } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { showcaseTestCommand } from "./showcase-check-policy.ts";

test("a remote showcase test signs once and the same pushed commit reuses its exact evidence", { timeout: 30_000 }, async () => {
  // Real Workerd/SQLite/RPC/crypto and authored graph. Prepared process results
  // are a system-boundary fixture; the Linux inspector is verified separately.
  const paths = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vite.config.ts", "tsconfig.json", "index.html", "src/app.ts", "src/message.ts", "src/message.test.ts", "packages/greeting/message.ts"].sort();
  const descriptor = { version: 1, uid: 1000, platform: "linux", arch: "x64", runtime: "v24.22.0", node: "c".repeat(64), dependencies: "d".repeat(64), dependencyFiles: 12,
    files: await Promise.all(paths.map(async path => {
      const bytes = await readFile(new URL(`../../../examples/demo/${path}`, import.meta.url));
      return { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    })),
  };
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
    import manifest from '../../../examples/demo/package.json';
    import {demoSite,demoSiteUrl} from '@effect-ci-testbed/cloudflare/demo-site';
    export {ShowcaseCIWorkflow} from './showcase-workflow.ts';
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    const commands=[],descriptor=${JSON.stringify(descriptor)};let changed=false,published;
    const assets={'index.html':'<h1>Checked</h1>','app.js':'export const app=1','message.js':'export const message="hello"'};
    export class WorkspaceContainer extends DurableObject {
      checkout(){} restore(){} stop(){} getCachedSnapshot(){} putCachedSnapshot(){}
      checkpoint(name){return{id:'fixture-'+name,name,size:1}}
      readFile(path){return path==='package.json'?JSON.stringify(manifest):assets[path.slice(5)]}
      exists(path){return path==='.'||path==='pnpm-lock.yaml'}
      execute(command){commands.push(command);const input=structuredClone(descriptor);if(changed)input.files.find(f=>f.path==='vite.config.ts').sha256='f'.repeat(64);
        return{exitCode:0,stderr:'',stdout:command.includes('/inspect-check.cjs')?JSON.stringify(input):'fake process success'}}
    }
    export class Publisher extends WorkerEntrypoint {async publish(revision,files){published=await demoSite(revision,files);return{revision,digest:published.digest,url:demoSiteUrl(published)}}}
    globalThis.fetch=async input=>{const url=new URL(String(input));
      if(url.hostname==='api.github.com')return Response.json(url.pathname.endsWith('/access_tokens')?{token:'fake-token'}:{id:1234,html_url:'https://github.com/example/check'});
      return new Response(published.assets[url.pathname.split('/').at(-1)],{headers:{'x-site-revision':published.revision,'x-site-digest':published.digest}})};
    export default{async fetch(request,env,ctx){const input=await request.json();
      if(input.op==='start'){changed=input.changed??false;await ctx.exports.ShowcaseCIWorkflow.create({id:input.id,params:{trigger:input.push?'github':'remote',repository:'https://github.com/ericclemmons/effect-ci-testbed.git',revision:input.revision??'a'.repeat(40),
        ...(input.push?{repositoryName:'ericclemmons/effect-ci-testbed',installationId:165265172,deliveryId:input.id,summaryCheckId:999,ref:'refs/heads/demo/showcase-preview'}:{targets:['test']})}});return Response.json(true)}
      if(input.op==='status')return Response.json(await(await ctx.exports.ShowcaseCIWorkflow.get(input.id)).status());
      return Response.json({commands});
    }};
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:workers", "node:*"] });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const name = "showcase-check-reuse";
  const runtime = new Miniflare({ workers: [{ config: { name, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
    exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, TrustedDemoChecks: { type: "durable-object", storage: "sqlite" }, ShowcaseCIWorkflow: { type: "workflow", name }, Publisher: { type: "worker" } },
    env: { VERSION_METADATA: { type: "json", value: { id: "11111111-1111-4111-8111-111111111111" } }, DEMO_SITE: { type: "worker", worker: name, exportName: "Publisher" },
      GITHUB_APP_ID: { type: "text", value: "5089816" }, GITHUB_PRIVATE_KEY: { type: "text", value: privateKey } },
  } }] });
  const call = async (body: unknown): Promise<any> => (await runtime.dispatchFetch("https://probe.invalid", { method: "POST", body: JSON.stringify(body) })).json();
  const run = async (id: string, options = {}) => {
    await call({ op: "start", id, ...options });
    for (let i = 0; i < 200; i++) {
      const status = await call({ op: "status", id });
      assert.notEqual(status.status, "errored", JSON.stringify(status.error));
      if (status.status === "complete") return status.output;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Showcase receipt run did not complete");
  };
  try {
    const remote = await run("remote");
    assert.equal(remote.evidence.receipts.length, 1);
    const original = JSON.stringify(remote.evidence.receipts);
    const pushed = await run("pushed", { push: true });
    assert.equal(pushed.nodes.find((node: any) => node.id === "test").status, "verified");
    assert.equal(JSON.stringify(pushed.evidence.receipts), original);
    const key = await crypto.subtle.importKey("jwk", remote.evidence.publicKey, "Ed25519", false, ["verify"]);
    const receipt = remote.evidence.receipts[0];
    assert.equal(await verifyRunnerCheckReceipt(JSON.stringify(receipt), receipt.claim.identity, new Map([[remote.evidence.keyId, key]])), true);
    const changed = await run("changed-suite", { changed: true });
    assert.equal(changed.nodes.find((node: any) => node.id === "test").status, "complete");
    const revision = await run("changed-revision", { revision: "b".repeat(40) });
    assert.equal(revision.nodes.find((node: any) => node.id === "test").status, "complete");
    assert.equal((await call({ op: "state" })).commands.filter((command: string) => command === showcaseTestCommand).length, 3);
    assert.equal(JSON.stringify(remote.evidence.receipts), original, "later attempts never rewrite earlier evidence");
  } finally { await runtime.dispose(); }
});
