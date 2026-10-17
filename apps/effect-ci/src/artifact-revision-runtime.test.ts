import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test("restored artifact reads retain the artifact revision, not its ancestor workspace", async () => {
  const output = await build({
    stdin: {
      resolveDir: new URL(".", import.meta.url).pathname,
      loader: "ts",
      contents: `
      import {DurableObject} from 'cloudflare:workers';
      import * as CI from '@effect-ci-testbed/ci';
      import {makeRunner} from '@effect-ci-testbed/cloudflare';
      import * as Effect from 'effect/Effect';
      export class WorkspaceContainer extends DurableObject {
        restored;
        materialized;
        async restore(snapshot){this.restored=snapshot.id;}
        async readFile(_path,_cwd,_step,revision){return JSON.stringify({restored:this.restored,requested:revision.id});}
        async exists(_path,_cwd,_step,revision){this.materialized=revision?.id;return true;}
        async checkpoint(name,_release,commit){if(name.endsWith('-workspace')&&!commit)throw Error('Final action commits must be immutable');if(commit){if(commit.stepId!=='pass-through')throw Error('Wrong commit owner');this.materialized=commit.revision?.id;}return {id:'published-'+this.materialized,name,size:2};}
      }
      export default {async fetch(request,env,ctx){
        let lookups=0;
        const binding={getByName(name){lookups++;return ctx.exports.WorkspaceContainer.getByName(name);}};
        const runner=makeRunner({binding,repository:'https://github.com/example/fixture',revision:'a'.repeat(40),workspaceId:'artifact-probe',step:{do:async(_name,...args)=>args.at(-1)()}});
        const foreign=new URL(request.url).searchParams.has('foreign');
        const workspace=CI.Workspace.remote(foreign?'another-run':'artifact-probe','/workspace/repository',{provider:'cloudflare-container',value:{id:'ancestor',size:1}});
        const checkpoint=new CI.WorkspaceCheckpoint('artifact:build',workspace,{provider:'cloudflare-container',value:{id:'artifact',size:2}});
        if(new URL(request.url).searchParams.has('publish'))return Response.json(await Effect.runPromise(runner.persistence.checkpoint({stepId:'publish',workspace,name:'artifact:build'})));
        if(new URL(request.url).searchParams.has('commit'))return Response.json((await Effect.runPromise(runner.persistence.commit({stepId:'pass-through',workspace}))).revision);
        let restored;
        try{restored=await Effect.runPromise(runner.persistence.restore({stepId:'consume',checkpoint}));}
        catch{return Response.json({rejected:true,lookups},{status:409});}
        return Response.json({revision:restored.revision.value.id,read:JSON.parse(await Effect.runPromise(runner.fileSystem.readFile(restored,'dist/index.html','consume')))});
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
          name: "artifact-revision-probe",
          compatibilityDate: "2026-10-07",
          compatibilityFlags: ["nodejs_compat"],
          manifest: {
            mainModule: "index.js",
            modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } },
          },
          exports: { WorkspaceContainer: { type: "durable-object", storage: "sqlite" } },
        },
      },
    ],
  });
  try {
    const response = await runtime.dispatchFetch("https://probe.invalid/");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      revision: "artifact",
      read: { restored: "artifact", requested: "artifact" },
    });
    const foreign = await runtime.dispatchFetch("https://probe.invalid/?foreign");
    assert.equal(foreign.status, 409);
    assert.deepEqual(await foreign.json(), { rejected: true, lookups: 1 });
    const published = await runtime.dispatchFetch("https://probe.invalid/?publish");
    assert.equal(published.status, 200);
    assert.equal((await published.json()).value.id, "published-ancestor");
    const committed = await runtime.dispatchFetch("https://probe.invalid/?commit");
    assert.equal(committed.status, 200);
    assert.equal((await committed.json()).value.id, "published-ancestor");
  } finally {
    await runtime.dispose();
  }
});
