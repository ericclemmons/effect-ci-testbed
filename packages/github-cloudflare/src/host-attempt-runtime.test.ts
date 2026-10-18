import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "both native adapters record actual successful/failed CI attempts before host continuation, never client claims",
  { timeout: 30_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(
      new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
    import{DurableObject}from'cloudflare:workers';
    import*as Native from'@effect-ci-testbed/cloudflare';import*as GitHub from'./index.ts';
    import{hostAttemptProgram}from'./host-attempt.fixture.ts';
    import{signExecutionReceipt,verifyExecutionReceipt}from'../../cloudflare/src/execution-receipt.ts';
    export class WorkspaceContainer extends DurableObject{async checkpoint(){return{id:'immutable-build-snapshot',size:12};}}
    const observations=[];let bodies=0;
    const keys=crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
    const identity={issuer:'https://ci.acme.example',repository:'https://github.com/acme/private.git',revision:'a'.repeat(40),
      workflowId:'attempt-fixture',policyDigest:'b'.repeat(64),runtimeDigest:'c'.repeat(64),inputsDigest:'d'.repeat(64),eventDigest:'e'.repeat(64)};
    const program=(fail=false,workspace=false)=>hostAttemptProgram(fail,workspace,()=>bodies++);
    const record=(fail=false)=>async(attempt,context)=>{
      if(context.environment.HOST_MARKER!=='host-only-marker')throw Error('Missing host context');
      const key=await keys;
      const receipt=await signExecutionReceipt({keyId:'acme',key:key.privateKey,identity,instanceId:context.instanceId,attempt});
      if(!await verifyExecutionReceipt(JSON.stringify(receipt),identity,new Map([['acme',key.publicKey]])))throw Error('Receipt verification failed');
      observations.push({phase:'attempt',instance:context.instanceId,repository:context.parameters.repository,revision:context.parameters.revision,
        conclusion:attempt.conclusion,number:attempt.number,nodes:attempt.plan.nodes.map(({id,status,dependencies})=>({id,status,dependencies})),
        passedCheckPresent:Object.hasOwn(attempt.outputs,'test'),outputs:attempt.outputs,receipt});
      if(fail)throw Error('PRIVATE_SIGNER_ERROR');
    };
    export const NativeSuccess=Native.workflowEntrypoint(program(),{cache:false,onAttempt:record()});
    export const NativeFailed=Native.workflowEntrypoint(program(true),{cache:false,onAttempt:record()});
    export const NativeRecordFailed=Native.workflowEntrypoint(program(),{cache:false,onAttempt:record(true)});
    export const GitHubSuccess=GitHub.workflowEntrypoint(program(),{cache:false,onAttempt:record()});
    export const WorkspaceScenario=GitHub.workflowEntrypoint(program(false,true),{cache:false,onAttempt:record()});
    export const Failed=GitHub.workflowEntrypoint(program(true),{cache:false,onAttempt:record()});
    export const RecordFailed=GitHub.workflowEntrypoint(program(),{cache:false,onAttempt:record(true)});
    export const Finalized=GitHub.workflowEntrypoint(program(),{cache:false,onAttempt:record(),finalize:async()=>{
      observations.push({phase:'finalize'});throw Error('Fixture continuation failure');
    }});
    export const Default=GitHub.workflowEntrypoint(program(),{cache:false});
    export default{async fetch(request,env,ctx){const input=await request.json();
      if(input.op==='start'){observations.length=0;bodies=0;await ctx.exports[input.name].create({id:input.id,params:{trigger:'remote',repository:'https://github.com/acme/private.git',revision:'a'.repeat(40),claimedConclusion:'success',claimedOutputs:{test:'FORGED'}}});return Response.json({started:true});}
      if(input.op==='status')return Response.json(await(await ctx.exports[input.name].get(input.id)).status());
      return Response.json({observations,bodies});
    }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      conditions: ["workerd", "import"],
      external: ["cloudflare:*", "node:*"],
    });
    const names = [
      "NativeSuccess",
      "NativeFailed",
      "NativeRecordFailed",
      "GitHubSuccess",
      "WorkspaceScenario",
      "Failed",
      "RecordFailed",
      "Finalized",
      "Default",
    ];
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "host-attempt-test",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
            },
            exports: {
              WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
              ...Object.fromEntries(
                names.map((name) => [name, { type: "workflow", name: name.toLowerCase() }]),
              ),
            },
            env: { HOST_MARKER: { type: "text", value: "host-only-marker" } },
          },
        },
      ],
    });
    const call = async (input: unknown): Promise<any> =>
      (
        await runtime.dispatchFetch("https://fixture.invalid", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).json();
    try {
      for (const name of names) {
        const id = name.toLowerCase();
        await call({ op: "start", name, id });
        let status: any;
        for (let n = 0; n < 200; n++) {
          status = await call({ op: "status", name, id });
          if (["complete", "errored"].includes(status.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          status.status,
          ["Failed", "NativeFailed", "RecordFailed", "NativeRecordFailed", "Finalized"].includes(
            name,
          )
            ? "errored"
            : "complete",
          JSON.stringify(status),
        );
        assert.doesNotMatch(JSON.stringify(status), /PRIVATE_SIGNER_ERROR|host-only-marker|FORGED/);
        const { observations, bodies } = await call({});
        assert.equal(bodies, 3);
        if (name === "Default") {
          assert.deepEqual(observations, []);
          continue;
        }
        assert.deepEqual(
          observations.map((value: any) => value.phase),
          name === "Finalized" ? ["attempt", "finalize"] : ["attempt"],
        );
        const actual = observations[0];
        assert.equal(actual.instance, id);
        assert.equal(actual.revision, "a".repeat(40));
        assert.equal(actual.number, 1);
        assert.equal(actual.receipt.purpose, "execution-observation");
        assert.equal(actual.receipt.claim.instanceId, id);
        assert.equal(actual.receipt.claim.conclusion, actual.conclusion);
        assert.deepEqual(actual.receipt.claim.steps.find((s: any) => s.id === "test").output, { kind: "void" });
        assert.equal(actual.receipt.claim.steps.find((s: any) => s.id === "build").output?.kind,
          ["Failed", "NativeFailed"].includes(name) ? undefined : name === "WorkspaceScenario" ? "workspace" : "json");
        assert.doesNotMatch(JSON.stringify(actual.receipt), /immutable-build-snapshot|artifact-handle|FORGED|host-only-marker/);
        assert.equal(actual.repository, "https://github.com/acme/private.git");
        assert.equal(
          actual.conclusion,
          ["Failed", "NativeFailed"].includes(name) ? "failure" : "success",
        );
        assert.deepEqual(actual.outputs.prepare, { prepared: true });
        assert.equal(
          actual.passedCheckPresent,
          true,
          "A passed void check is not a missing result",
        );
        assert.equal(actual.nodes.find((node: any) => node.id === "test").status, "complete");
        assert.deepEqual(actual.nodes.find((node: any) => node.id === "test").dependencies, [
          "prepare",
        ]);
        assert.deepEqual(actual.nodes.find((node: any) => node.id === "build").dependencies, [
          "test",
        ]);
        if (["Failed", "NativeFailed"].includes(name))
          assert.equal(Object.hasOwn(actual.outputs, "build"), false);
        else if (name === "WorkspaceScenario")
          assert.deepEqual(actual.outputs.build, {
            kind: "remote",
            id,
            cwd: "/workspace/repository",
            revision: {
              provider: "cloudflare-container",
              value: { id: "immutable-build-snapshot", size: 12 },
            },
          });
        else assert.equal(actual.outputs.build, "artifact-handle");
        if (["RecordFailed", "NativeRecordFailed"].includes(name))
          assert.match(status.error.message, /Host attempt recording failed/);
      }
    } finally {
      await runtime.dispose();
    }
  },
);
