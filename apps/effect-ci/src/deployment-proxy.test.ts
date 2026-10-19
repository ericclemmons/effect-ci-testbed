import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { DeploymentProxy, deploymentToken } from "./deployment-proxy.ts";

test("default upstream fetch works in actual Workerd, with host authentication and streamed request body", async () => {
  const require = createRequire(import.meta.url);
  const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const output = await build({ stdin: {
    resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
      import {DeploymentProxy} from './deployment-proxy.ts';
      export default {async fetch(request){
        const proxy=new DeploymentProxy('account','host-fixture-token');
        return proxy.fetch(new Request('https://api.cloudflare.com/client/v4/accounts/account/workers/workers/fixture',{
          method:request.method,headers:{authorization:'Bearer effect-ci-outbound-proxy'},
          ...(request.method==='POST'?{body:request.body}:{}),
        }));
      }};
    ` }, bundle: true, format: "esm", platform: "neutral", target: "esnext", write: false });
  const runtime = new Miniflare({ workers: [
    { config: { name: "deployment-proxy-test", compatibilityDate: "2026-10-07",
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } }, exports: {} },
      dev: { outboundService: { type: "worker", worker: "cloudflare-api-fixture" } } },
    { config: { name: "cloudflare-api-fixture", compatibilityDate: "2026-10-07", exports: {},
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: `
        export default {async fetch(request){
          if(request.headers.get('authorization')!=='Bearer host-fixture-token')return new Response('unauthorized',{status:401});
          if(request.redirect!=='manual')throw Error('Redirect policy changed');
          return Response.json({method:request.method,body:await request.text()});
        }};
      ` } } } } },
  ] });
  try {
    for (const method of ["GET", "POST"]) {
      const response = await runtime.dispatchFetch("https://proxy.invalid/", { method,
        ...(method === "POST" ? { body: "fixture upload" } : {}) });
      const body = await response.text();
      assert.equal(response.status, 200, body);
      assert.deepEqual(JSON.parse(body), { method, body: method === "POST" ? "fixture upload" : "" });
    }
  } finally { await runtime.dispose(); }
});

test("outbound proxy adds host-only account and registry authentication, never returning registry secrets", async () => {
  const calls: Request[] = [];
  const proxy = new DeploymentProxy("account", "private-account-token", async request => {
    calls.push(request);
    return request.url.endsWith("/credentials")
      ? Response.json({ success: true, result: { username: "v1", password: "private-registry-password" } })
      : new Response("ok");
  });
  const send = (url: string) => proxy.fetch(new Request(url, { headers: { authorization: `Bearer ${deploymentToken}` } }));
  assert.equal((await send("https://registry.cloudflare.com/v2/")).status, 403);
  const result = await send("https://api.cloudflare.com/client/v4/accounts/account/containers/registries/registry.cloudflare.com/credentials");
  assert.equal(await result.text(), JSON.stringify({ success: true, result: { username: deploymentToken, password: deploymentToken } }));
  assert.equal(calls[0].headers.get("authorization"), "Bearer private-account-token");
  assert.equal(await (await send("https://registry.cloudflare.com/v2/account/image/manifests/latest")).text(), "ok");
  assert.equal(calls[1].headers.get("authorization"), `Basic ${btoa("v1:private-registry-password")}`);
  for (const url of ["https://api.cloudflare.com/client/v4/accounts/other/workers/scripts", "http://api.cloudflare.com/client/v4/accounts/account/workers/scripts", "https://attacker.invalid/", "https://api.cloudflare.com/client/v4/user/tokens"])
    assert.equal((await send(url)).status, 403);
  assert.equal(calls.length, 2);
});

test("proxy does not follow redirects or expose transport error credentials", async () => {
  const proxy = new DeploymentProxy("account", "private", async request => {
    assert.equal(request.redirect, "manual");
    throw Error("private");
  });
  const result = await proxy.fetch(new Request("https://api.cloudflare.com/client/v4/accounts/account/workers/scripts"));
  assert.equal(result.status, 502);
  assert.equal(await result.text(), "Deployment upstream request failed");
});

test("Docker bearer exchanges also retain real tokens outside the container", async () => {
  const proxy = new DeploymentProxy("account", "private", async request => {
    if (request.url.endsWith("/credentials")) return Response.json({ result: { username: "v1", password: "registry-secret" } });
    if (request.url.endsWith("/token")) return Response.json({ token: "registry-bearer", access_token: "registry-bearer", expires_in: 60 });
    assert.equal(request.headers.get("authorization"), "Bearer registry-bearer");
    return new Response("published");
  });
  await proxy.fetch(new Request("https://api.cloudflare.com/client/v4/accounts/account/containers/registries/registry.cloudflare.com/credentials"));
  const token = await (await proxy.fetch(new Request("https://registry.cloudflare.com/token"))).json();
  assert.deepEqual(token, { token: deploymentToken, access_token: deploymentToken, expires_in: 60 });
  assert.equal(await (await proxy.fetch(new Request("https://registry.cloudflare.com/v2/account/image/manifests/latest", {
    headers: { authorization: `Bearer ${deploymentToken}` },
  }))).text(), "published");
});
