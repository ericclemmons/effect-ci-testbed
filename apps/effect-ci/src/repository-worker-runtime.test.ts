import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test("one host routes root repository runs separately from existing demo services", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import {WorkerEntrypoint} from "cloudflare:workers";
    import host from "./worker.ts";
    const calls=[];
    const repository={create:async input=>{calls.push(input)},get:async id=>({status:async()=>({status:"complete",output:{repository:true}})})};
    const demo={create:async()=>{throw Error("must not use demo workflow")}};
    export default class Driver extends WorkerEntrypoint {
      async fetch(request) {
        if(new URL(request.url).pathname==="/trace")return Response.json(calls);
        return host.fetch(request,this.env,{exports:{RepositoryCIWorkflow:repository,DemoCIWorkflow:demo,EffectCIWorkflow:demo}});
      }
    }
  `, resolveDir: new URL(".", import.meta.url).pathname, loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", platform: "neutral",
    external: ["node:*", "cloudflare:*"], conditions: ["workerd", "import"],
    plugins: [{ name: "assets", setup(builder: { onResolve: Function }) {
      builder.onResolve({ filter: /index_bg\.wasm$/ }, () => ({ path: "./chart.wasm", external: true }));
      builder.onResolve({ filter: /ABeeZee-Regular\.ttf\.bin$/ }, () => ({ path: "./font.bin", external: true }));
    } }],
  });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "repository-routing-fixture", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: {
      "index.js": { type: "esm", contents: output.outputFiles[0].text },
      "chart.wasm": { type: "wasm", contents: new Uint8Array(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))) },
      "font.bin": { type: "data", contents: new Uint8Array(await readFile(new URL("../../../packages/github-cloudflare/assets/ABeeZee-Regular.ttf.bin", import.meta.url))) },
    } },
    env: { EFFECT_CI_API_TOKEN: { type: "text", value: "existing-host-token" }, GITHUB_WEBHOOK_SECRET: { type: "text", value: "fixture-secret" } },
  } }] });
  const headers = { authorization: "Bearer existing-host-token", "content-type": "application/json" };
  const request = (path: string, init?: RequestInit) => runtime.dispatchFetch("https://one-host.invalid" + path, init);
  try {
    assert.equal((await request("/capabilities")).status, 401);
    assert.equal((await request("/runs", { method: "POST", body: "{}" })).status, 401);
    const capabilities = await (await request("/capabilities", { headers })).json();
    assert.equal(capabilities.targetDiscovery, "project");
    assert.deepEqual(capabilities.authentication, ["api-token", "cloudflare-access-identity", "github-oidc", "hosted-workload"]);
    const demoCapabilities = await (await request("/demo/capabilities", { headers })).json();
    assert.notEqual(demoCapabilities.targetDiscovery, "project");
    assert.ok(demoCapabilities.targets.includes("build"));
    const input = { repository: "https://github.com/example/new-repo.git", revision: "a".repeat(40), targets: ["build"] };
    const started = await request("/runs", { method: "POST", headers, body: JSON.stringify(input) });
    assert.equal(started.status, 202, await started.clone().text());
    const run = await started.json();
    assert.match(run.statusUrl, /^https:\/\/one-host.invalid\/runs\//);
    const status = await (await runtime.dispatchFetch(run.statusUrl, { headers })).json();
    assert.deepEqual(status.output, { repository: true });
    const trace = await (await request("/trace")).json();
    assert.equal(trace.length, 1);
    assert.deepEqual(trace[0].params, { trigger: "remote", ...input });
    assert.equal((await request("/webhooks/github", { method: "POST", body: "{}" })).status, 401);
  } finally { await runtime.dispose(); }
});
