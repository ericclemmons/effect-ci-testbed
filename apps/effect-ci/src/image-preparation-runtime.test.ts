import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { DeploymentProxy } from "./deployment-proxy.ts";

test("Workerd retries only exact digest-pinned idempotent image preparation after explicit transient responses", async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const output = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {DeploymentProxy} from './deployment-proxy.ts';
    export default {async fetch(request){
      const mode=new URL(request.url).pathname.slice(1);
      const image='registry.cloudflare.com/'+(mode==='foreign'?'other':'account')+'/fixture@sha256:'+'a'.repeat(64);
      const body=mode==='invalid'?{image:'registry.cloudflare.com/account/fixture:latest'}:
        mode==='extra'?{image,extra:'not-in-contract'}:{image};
      const path=mode==='upload'?'workers/scripts/fixture':'containers/image-preparations';
      return new DeploymentProxy('account','host-fixture-token').fetch(new Request('https://api.cloudflare.com/client/v4/accounts/account/'+path+(mode==='query'?'?unknown=value':''),{
        method:mode==='get'?'GET':'POST',headers:{'content-type':'application/json','x-fixture-mode':mode},
        ...(mode==='get'?{}:{body:JSON.stringify(body)}),
      }));
    }};
  ` }, bundle: true, format: "esm", platform: "neutral", target: "esnext", write: false });
  const runtime = new Miniflare({ workers: [
    { config: { name: "image-proxy", compatibilityDate: "2026-10-07", exports: {},
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } } },
      dev: { outboundService: { type: "worker", worker: "api-fixture" } } },
    { config: { name: "api-fixture", compatibilityDate: "2026-10-07", exports: {},
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: `
        const calls=new Map();
        export default {async fetch(request){
          if(request.headers.get('authorization')!=='Bearer host-fixture-token'||request.redirect!=='manual')throw Error('Authentication or redirect changed');
          const mode=request.headers.get('x-fixture-mode'),body=await request.text();
          const previous=calls.get(mode)||{count:0,body};
          if(previous.body!==body)throw Error('Retried a changed body');
          previous.count++;calls.set(mode,previous);
          const status=mode==='rate'?429:mode==='unsupported'?501:mode==='terminal'?200:
            mode==='persistent'?503:mode.startsWith('recover')&&previous.count>1?200:
            mode==='recover502'?502:mode==='recover504'?504:500;
          return Response.json({calls:previous.count,status:mode==='terminal'?'error':'ready'},{status});
        }};
      ` } } } } },
  ] });
  try {
    for (const [mode, status, calls] of [
      ["recover", 200, 2], ["recover502", 200, 2], ["recover504", 200, 2], ["persistent", 503, 4],
      ["upload", 500, 1], ["invalid", 500, 1], ["foreign", 500, 1], ["extra", 500, 1],
      ["get", 500, 1], ["query", 500, 1], ["rate", 429, 1], ["unsupported", 501, 1], ["terminal", 200, 1],
    ] as const) {
      const response = await runtime.dispatchFetch(`https://proxy.invalid/${mode}`);
      assert.equal(response.status, status, mode);
      assert.equal((await response.json() as {calls:number}).calls, calls, mode);
    }
  } finally { await runtime.dispose(); }
});

test("even a valid idempotent preparation does not replay a transport exception", async () => {
  let calls = 0;
  const proxy = new DeploymentProxy("account", "private-token", async () => {
    calls++;
    throw Error("arbitrary-private-provider-cause");
  });
  const response = await proxy.fetch(new Request("https://api.cloudflare.com/client/v4/accounts/account/containers/image-preparations", {
    method: "POST", body: JSON.stringify({image: `registry.cloudflare.com/account/fixture@sha256:${"a".repeat(64)}`}),
  }));
  assert.equal(calls, 1);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), "Deployment upstream request failed");
});
