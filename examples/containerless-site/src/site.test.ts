import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { SOURCE_FILES, LIMITS, checkoutSource, filesFor, buildSite } from "./site.ts";
const source = Object.fromEntries(
  await Promise.all(
    SOURCE_FILES.map(async (name) => [
      name,
      await readFile(new URL(`../site/${name}`, import.meta.url), "utf8"),
    ]),
  ),
);
const revision = "a".repeat(40);
test("source is fixed-target, full-commit, bounded and redirect-denying", async () => {
  let calls = 0;
  const fetched = await checkoutSource(revision, async (url, options) => {
    calls++;
    assert.equal(options?.redirect, "manual");
    assert.ok(
      String(url).startsWith(
        `https://raw.githubusercontent.com/ericclemmons/effect-ci-testbed/${revision}/examples/containerless-site/site/`,
      ),
    );
    return new Response(source[String(url).split("/").at(-1)!]);
  });
  assert.deepEqual({ ...fetched }, source);
  assert.equal(calls, 5);
  await assert.rejects(checkoutSource("main"));
  await assert.rejects(
    checkoutSource(
      revision,
      async () =>
        new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } }),
    ),
  );
  await assert.rejects(
    checkoutSource(revision, async () => new Response("x".repeat(LIMITS.sourceBytes + 1))),
  );
  for (const path of ["../index.html", "/index.html", "a/b.js", "constructor", "INDEX.HTML"])
    assert.throws(() => filesFor({ [path]: "x" }));
  assert.throws(() => filesFor({ "index.html": "x".repeat(LIMITS.outputBytes + 1) }));
});
test("child policy is explicit and malformed build output is rejected", async () => {
  let loaded = 0;
  const loader = {
    load(code: WorkerLoaderWorkerCode) {
      loaded++;
      assert.deepEqual(code.env, {});
      assert.equal(code.globalOutbound, null);
      assert.deepEqual(code.compatibilityFlags, []);
      assert.deepEqual(code.limits, { cpuMs: 250, subRequests: 0 });
      return {
        getEntrypoint: () => ({ fetch: async () => Response.json({ "../escape.html": "no" }) }),
      };
    },
  } as unknown as WorkerLoader;
  await assert.rejects(buildSite(loader, source), /Isolated site build failed/);
  assert.equal(loaded, 1);
});
test(
  "real workerd builds and serves the complete site, with immutable SQLite publication and denied child capabilities",
  { timeout: 30_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const pluginPath = await realpath(
      new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }));
    const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }));
    const output = await build({
      stdin: {
        contents: `
    import {SiteRevisions} from './worker.ts';
    import {buildSite,serveSite,digest,filesFor} from './site.ts';
    import * as CI from '@effect-ci-testbed/ci';
    import * as Effect from 'effect/Effect';
    import workflow,{SiteHost} from '../.cloudflare/ci/workflow.ts';
    export class Revisions extends SiteRevisions {
      async seed(revision,source){await this.ctx.storage.put('source:'+revision,filesFor(source,65536));}
      async corrupt(revision){await this.ctx.storage.put('site:'+revision,{revision,sourceDigest:'a'.repeat(64),assetDigest:'b'.repeat(64),assets:{'index.html':'wrong'}});}
    }
    export default {async fetch(request,env){
      const p=await request.json();const stub=env.REVISIONS.getByName('one-fixed-registry');
      let stage='seed';try{
        if(p.op==='corrupt'){await stub.corrupt(p.revision);return Response.json({ok:true});}
        if(p.op==='read') return Response.json(await stub.read(p.revision));
        if(p.op==='publish') return Response.json(await stub.publish(p.revision,p.assets,p.sourceDigest));
        await stub.seed(p.revision,p.source);
        if(p.op==='recipe') {
          const result=await CI.runPromise({...workflow,effect:workflow.effect.pipe(Effect.provideService(SiteHost,{
            checkout:()=>Effect.succeed(p.source),
            build:source=>Effect.tryPromise(()=>buildSite(env.LOADER,source)),
            publish:(source,assets)=>Effect.tryPromise(async()=>stub.publish(p.revision,assets,await digest(source))),
            verify:site=>Effect.tryPromise(async()=>{for(const [path,body]of Object.entries(site.assets)){const response=await serveSite(env.LOADER,site,path);if(await response.text()!==body)throw Error('mismatch');}return 'owned local fixture';}),
          }))},{ci:true,env:'cloudflare',output:'silent',executor:{execute:()=>Effect.die(Error('Container execution denied'))}});
          return Response.json(result.plan);
        }
        stage='build';const assets=await buildSite(env.LOADER,p.source);
        stage='publish';const site=await stub.publish(p.revision,assets,await digest(p.source));
        stage='serve';const responses={};for(const path of Object.keys(assets)){const response=await serveSite(env.LOADER,site,path);responses[path]={body:await response.text(),headers:Object.fromEntries(response.headers)};}
        return Response.json({site,responses});
      }catch{ return Response.json({error:'Rejected',stage},{status:422}); }
    }};
  `,
        resolveDir: new URL(".", import.meta.url).pathname,
        sourcefile: "probe.ts",
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      external: ["cloudflare:workers", "cloudflare:workflows", "node:*"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "site-probe",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } },
            },
            exports: { Revisions: { type: "durable-object", storage: "sqlite" } },
            env: {
              LOADER: { type: "worker-loader" },
              REVISIONS: { type: "durable-object", worker: "site-probe", exportName: "Revisions" },
            },
          },
        },
      ],
    });
    const send = async (body: object) => {
      const response = await runtime.dispatchFetch("https://probe.invalid", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      const result = await send({ revision, source });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.match(result.body.responses["index.html"].body, /CI without the container/);
      assert.match(result.body.responses["client.js"].body, /addEventListener/);
      assert.match(result.body.responses["style.css"].body, /color-scheme/);
      for (const response of Object.values(result.body.responses) as {
        headers: Record<string, string>;
      }[])
        assert.equal(response.headers["x-source-revision"], revision);
      assert.deepEqual((await send({ op: "read", revision })).body, result.body.site);
      const replay = await send({
        op: "publish",
        revision,
        assets: result.body.site.assets,
        sourceDigest: result.body.site.sourceDigest,
      });
      assert.deepEqual(replay.body, result.body.site);
      const recipe = await send({ op: "recipe", revision, source });
      assert.equal(recipe.status, 200, JSON.stringify(recipe.body));
      assert.equal(recipe.body.nodes.length, 4);
      assert.ok(
        recipe.body.nodes.every(
          (node: { status: string; commands: unknown[] }) =>
            node.status === "complete" && node.commands.length === 0,
        ),
      );
      assert.equal(
        (
          await send({
            op: "publish",
            revision,
            assets: { ...result.body.site.assets, "index.html": "changed" },
            sourceDigest: result.body.site.sourceDigest,
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await send({
            op: "publish",
            revision,
            assets: result.body.site.assets,
            sourceDigest: "0".repeat(64),
          })
        ).status,
        422,
      );
      const boundary = {
        ...source,
        "build.js": `export default {async fetch(req,env){let denied=false;try{await fetch('https://example.com')}catch{denied=true}if(!denied||Object.keys(env).length)throw Error('capabilities escaped');return Response.json({'index.html':'denied','client.js':'','style.css':''})}};`,
      };
      assert.equal((await send({ revision: "b".repeat(40), source: boundary })).status, 200);
      assert.equal(
        (
          await send({
            revision: "c".repeat(40),
            source: {
              ...source,
              "build.js": `export default {fetch(){throw Error('untrusted-private-text')}};`,
            },
          })
        ).status,
        422,
      );
      await send({ op: "corrupt", revision });
      assert.equal((await send({ op: "read", revision })).status, 422);
    } finally {
      await runtime.dispose();
    }
  },
);
