import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import { hostAttemptProgram } from "../../github-cloudflare/src/host-attempt.fixture.ts";
import { signExecutionReceipt, verifyExecutionReceipt, type ExecutionIdentity } from "./execution-receipt.ts";

test("private commit journal records a native run once and retains verified SQLite history across reload/revocation", { timeout: 30_000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const identity: ExecutionIdentity = {
    issuer: "https://ci.acme.example", repository: "https://github.com/acme/project.git", revision: "a".repeat(40),
    workflowId: "attempt-fixture", policyDigest: "b".repeat(64), runtimeDigest: "c".repeat(64), inputsDigest: "d".repeat(64), eventDigest: "e".repeat(64),
  };
  // Node's fully specified JWA name is newer than this workerd's JWK decoder.
  // RFC 8037 EdDSA metadata interoperates; import still explicitly pins Ed25519.
  const publicKeys = { acme: { ...await crypto.subtle.exportKey("jwk", keys.publicKey), alg: "EdDSA" } };
  const privateKey = { ...await crypto.subtle.exportKey("jwk", keys.privateKey), alg: "EdDSA" };
  const code = (await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import{DurableObject}from'cloudflare:workers';
    import{executionJournal,executionCommitName}from'./execution-journal.ts';
    import{signExecutionReceipt}from'./execution-receipt.ts';
    import{workflowEntrypoint}from'./index.ts';
    import{hostAttemptProgram}from'../../github-cloudflare/src/host-attempt.fixture.ts';
    const identity=${JSON.stringify(identity)};
    let bodies=0;
    export class Journal extends executionJournal({keys:async env=>new Map(await Promise.all(Object.entries(JSON.parse(env.PUBLIC_KEYS)).map(async([id,key])=>[
      id,await crypto.subtle.importKey('jwk',key,'Ed25519',false,['verify'])])))}){}
    export class WorkspaceContainer extends DurableObject{}
    const owner=async exports=>exports.Journal.getByName(await executionCommitName(identity));
    export const Native=workflowEntrypoint(hostAttemptProgram(false,false,()=>bodies++),{cache:false,onAttempt:async(attempt,context)=>{
      if(context.parameters.repository!==identity.repository||context.parameters.revision!==identity.revision)throw Error('Unenrolled fixture source');
      const key=await crypto.subtle.importKey('jwk',JSON.parse(context.environment.PRIVATE_KEY),'Ed25519',false,['sign']);
      const receipt=await signExecutionReceipt({keyId:'acme',key,identity,instanceId:context.instanceId,attempt});
      await(await owner(context.exports)).record(identity,JSON.stringify(receipt));
    }});
    // Test-only HTTP proxy. The exported library DO itself has no HTTP writer.
    export default{async fetch(request,env,ctx){const p=await request.json(),j=await owner(ctx.exports);
      try{let result;switch(p.op){
        case'name':result=await executionCommitName(p.subject??identity);break;
        case'stats':result={bodies};break;
        case'start':await ctx.exports.Native.create({id:p.id,params:{repository:identity.repository,revision:identity.revision,claimedConclusion:'success'}});result=true;break;
        case'status':result=await(await ctx.exports.Native.get(p.id)).status();break;
        case'record':result=await j.record(p.identity??identity,p.receipt);break;
        case'recordLost':await j.record(identity,p.receipt);throw Error('Fixture acknowledgement lost after commit');
        case'get':result=await j.get(p.identity??identity,p.id,p.attempt??1)??null;break;
        case'history':result=await j.history(p.subject??identity,p.after);break;
        case'http':result=(await j.fetch(new Request('https://private.invalid'))).status;break;
        default:throw Error('Unknown fixture operation');}
        return Response.json({ok:true,result});
      }catch(error){return Response.json({ok:false,error:error.message});}
    }};` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] })).outputFiles[0].text;
  const options = (trust = publicKeys, suffix = "") => ({ workers: [{ config: {
    name: "commit-journal-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: code + suffix } } },
    exports: { Journal: { type: "durable-object", storage: "sqlite" }, WorkspaceContainer: { type: "durable-object", storage: "sqlite" }, Native: { type: "workflow", name: "commit-journal-native" } },
    env: { PUBLIC_KEYS: { type: "text", value: JSON.stringify(trust) }, PRIVATE_KEY: { type: "text", value: JSON.stringify(privateKey) } },
  } }] });
  const runtime = new Miniflare(options());
  const call = async (input: unknown): Promise<any> => (await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: JSON.stringify(input) })).json();
  const createReceipt = async (id: string, expected = identity, fail = false) => {
    let attempt: CI.WorkflowAttempt | undefined;
    await CI.runPromise(hostAttemptProgram(fail), { output: "silent", onAttempt: value => { attempt = value; } }).catch(() => undefined);
    assert.ok(attempt);
    return JSON.stringify(await signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity: expected, instanceId: id, attempt }));
  };
  try {
    assert.notEqual((await call({ op: "name" })).result, (await call({ op: "name", subject: { ...identity, revision: "f".repeat(40) } })).result);
    assert.notEqual((await call({ op: "name" })).result, (await call({ op: "name", subject: { ...identity, repository: "https://github.com/acme/other.git" } })).result);
    for (const subject of [{ ...identity, revision: "main" }, { ...identity, issuer: "https://ci.example/path" },
      { ...identity, repository: "https://token@github.com/acme/project.git" }]) assert.equal((await call({ op: "name", subject })).ok, false);
    assert.equal((await call({ op: "http" })).result, 404);
    await call({ op: "start", id: "native-recorded" });
    let status: any;
    for (let i = 0; i < 200; i++) {
      status = (await call({ op: "status", id: "native-recorded" })).result;
      if (["complete", "errored"].includes(status.status)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(status.status, "complete", JSON.stringify(status));
    assert.equal((await call({ op: "stats" })).result.bodies, 3);
    const native = (await call({ op: "get", id: "native-recorded" })).result;
    const claim = await verifyExecutionReceipt(native, identity, new Map([["acme", keys.publicKey]]));
    assert.equal(claim?.conclusion, "success");
    assert.equal(claim.steps.find(s => s.id === "test")!.output!.kind, "void");
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => call({ op: "record", receipt: native })));
    assert.ok(concurrent.every(r => r.ok && !r.result.created));
    const receipt = await createReceipt("concurrent");
    const writes = await Promise.all(Array.from({ length: 8 }, () => call({ op: "record", receipt })));
    assert.equal(writes.filter(r => r.ok && r.result.created).length, 1);
    const conflict = await createReceipt("concurrent", identity, true);
    assert.equal((await call({ op: "record", receipt: conflict })).error, "Immutable execution record conflict");
    assert.equal((await call({ op: "get", id: "concurrent" })).result, receipt);
    const lost = await createReceipt("lost-ack");
    assert.equal((await call({ op: "recordLost", receipt: lost })).ok, false);
    assert.equal((await call({ op: "get", id: "lost-ack" })).result, lost);
    assert.equal((await call({ op: "record", receipt: lost })).result.created, false);
    const failed = await createReceipt("failed-run", identity, true);
    assert.equal((await call({ op: "record", receipt: failed })).ok, true);
    assert.equal(JSON.parse((await call({ op: "get", id: "failed-run" })).result).claim.conclusion, "failure");
    for (const field of ["workflowId", "inputsDigest", "policyDigest", "runtimeDigest", "eventDigest"]) {
      const changed = { ...identity, [field]: field === "workflowId" ? "another-workflow" : "f".repeat(64) };
      assert.equal((await call({ op: "get", id: "native-recorded", identity: changed })).result, null, field);
    }
    const foreign = { ...identity, revision: "f".repeat(40) };
    assert.equal((await call({ op: "record", identity: foreign, receipt: await createReceipt("foreign", foreign) })).ok, false);
    assert.equal((await call({ op: "get", identity: foreign, id: "native-recorded" })).result, null);
    assert.equal((await call({ op: "record", receipt: native.replace('"success"', '"failure"') })).ok, false);
    for (let i = 0; i < 26; i++) assert.equal((await call({ op: "record", receipt: await createReceipt(`local-${i}`) })).ok, true);
    const first = (await call({ op: "history" })).result;
    assert.equal((await call({ op: "history", after: "../foreign" })).ok, false);
    assert.equal(first.receipts.length, 25); assert.match(first.next, /^[a-f0-9]{64}$/);
    const second = (await call({ op: "history", after: first.next })).result;
    assert.equal(second.receipts.length, 5); assert.equal(second.next, undefined);
    assert.equal(new Set([...first.receipts, ...second.receipts].map(r => JSON.parse(r).claim.instanceId)).size, 30);
    await runtime.setOptions(options(publicKeys, "\n// reload same durable journal\n"));
    assert.equal((await call({ op: "stats" })).result.bodies, 0);
    assert.equal((await call({ op: "get", id: "native-recorded" })).result, native);
    assert.equal((await call({ op: "record", receipt: native })).result.created, false);
    await runtime.setOptions(options({} as typeof publicKeys, "\n// revoke key, retain all history\n"));
    assert.equal((await call({ op: "get", id: "native-recorded" })).result, null);
    assert.deepEqual((await call({ op: "history" })).result.receipts, []);
    assert.equal((await call({ op: "history" })).result.unverified, 25);
    assert.equal((await call({ op: "record", receipt: native })).ok, false);
    await runtime.setOptions(options(publicKeys, "\n// restore test trust, no new execution\n"));
    assert.equal((await call({ op: "get", id: "native-recorded" })).result, native);
    assert.equal((await call({ op: "history" })).result.receipts.length, 25);
    assert.equal((await call({ op: "stats" })).result.bodies, 0, "reads and restored trust never rerun native actions");
  } finally { await runtime.dispose(); }
});
