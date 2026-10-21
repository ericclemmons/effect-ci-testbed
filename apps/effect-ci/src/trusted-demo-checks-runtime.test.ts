import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { syntaxCommand, syntaxRepository, syntaxWorkflow } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { demoRunnerPolicyDigest } from "./demo-runner-policy.ts";
import { verifyRunnerCheckReceipt } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
const require = createRequire(import.meta.url);
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }));
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }));

test("actual SQLite authority signs once, verifies on another run, and never exports its private key", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    export {TrustedDemoChecks} from './trusted-demo-checks.ts';
    export default {async fetch(request,env){
      const {operation,claim}=await request.json();const owner=env.CHECKS.getByName('trusted');
      if(operation==='record')await Promise.all([owner.record(claim),owner.record({...claim,runId:'duplicate'})]);
      if(operation==='deny'){try{await owner.record(claim);return Response.json({rejected:false})}catch{return Response.json({rejected:true})}}
      return Response.json({verified:await owner.lookup(claim.identity),receipt:await owner.receipt(claim.identity),key:await owner.publicKey()});
    }};`, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "trusted-probe.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers", "node:*"] });
  const name = "trusted-runner-probe";
  const runtime = new Miniflare({ workers: [{ config: {
    name, compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { TrustedDemoChecks: { type: "durable-object", storage: "sqlite" } },
    env: { CHECKS: { type: "durable-object", worker: name, exportName: "TrustedDemoChecks" } },
  } }] });
  const identity = { kind: "check" as const, repository: syntaxRepository, workflowId: syntaxWorkflow,
    stepId: "syntax", command: syntaxCommand, revision: "a".repeat(40),
    policyDigest: await demoRunnerPolicyDigest(false), sourceDigest: "b".repeat(64), toolchainDigest: "c".repeat(64) };
  const claim = { identity, runId: "remote-first", exitCode: 0,
    completedAt: "2026-10-17T00:00:00.000Z", stdoutDigest: "d".repeat(64), stderrDigest: "e".repeat(64) };
  const send = async (operation: string, value = claim) => (await runtime.dispatchFetch("https://probe.invalid", {
    method: "POST", body: JSON.stringify({ operation, claim: value }),
  })).json();
  try {
    assert.equal((await send("lookup")).verified, false);
    const first = await send("record");
    assert.equal(first.verified, true);
    assert.equal(JSON.parse(first.receipt).claim.runId, "remote-first");
    assert.equal(first.key.publicKey.d, undefined);
    const publicKey = await crypto.subtle.importKey("jwk", first.key.publicKey, "Ed25519", false, ["verify"]);
    assert.equal(await verifyRunnerCheckReceipt(first.receipt, identity, new Map([[first.key.keyId, publicKey]])), true);
    const replay = await send("record", { ...claim, runId: "scm-later" });
    assert.equal(replay.receipt, first.receipt);
    assert.deepEqual(replay.key, first.key);
    assert.equal((await send("lookup", { ...claim, identity: { ...identity, revision: "f".repeat(40) } })).verified, false);
    assert.equal((await send("deny", { ...claim, identity: { ...identity, stepId: "deploy" } })).rejected, true);
    assert.equal((await send("deny", { ...claim, exitCode: 1 })).rejected, true);
  } finally { await runtime.dispose(); }
});
