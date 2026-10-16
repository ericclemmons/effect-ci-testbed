import assert from "node:assert/strict";
import { builtinModules, createRequire } from "node:module";
import { dirname } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

// Investigation of genuine pinned artifacts, not an adapter or formatter success.
// Tool code is never imported/evaluated in the Node test process.
const require = createRequire(import.meta.url);
const vitePlus = require.resolve("vite-plus/package.json");
const tools = createRequire(vitePlus);
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const artifact = (name, version) => {
  const entry = realpathSync(tools.resolve(name));
  const metadata = JSON.parse(readFileSync(dirname(entry) + "/../package.json", "utf8"));
  assert.equal(metadata.version, version, "Reinvestigate before changing the pinned finding");
  return { entry, metadata };
};
const compile = async (contents) => (await build({
  stdin: { contents, resolveDir: dirname(vitePlus), loader: "js" },
  bundle: true, write: false, format: "esm", platform: "neutral",
  conditions: ["workerd", "import"], logLevel: "silent",
  // Preserve unsupported imports. No mocks, native addons, Node execution,
  // process/FS shims or fallback formatter are substituted.
  external: [...builtinModules, ...builtinModules.map(m => "node:" + m),
    "@prettier/*", "prettier-plugin-*", "@zackad/*", "@shopify/*"],
})).outputFiles[0].text;
const runtime = () => new Miniflare({ workers: [{ config: {
  name: "oxc-compatibility", compatibilityDate: "2026-10-07",
  env: { LOADER: { type: "worker-loader" } },
  manifest: { mainModule: "bridge.js", modules: { "bridge.js": { type: "esm", contents: `
    export default{async fetch(request,env){const {code}=await request.json();try{
      const child=env.LOADER.load({compatibilityDate:'2026-10-07',compatibilityFlags:[],
        mainModule:'index.js',modules:{'index.js':code},env:{},globalOutbound:null,
        limits:{cpuMs:1000,subRequests:0}}).getEntrypoint();
      const response=await child.fetch(new Request('https://tool.invalid'));
      return Response.json({loaded:true,status:response.status,value:await response.json()});
    }catch(error){return Response.json({loaded:false,message:String(error).slice(0,2000)})}}};
  ` } } },
  exports: {},
} }] });

test("Oxfmt 0.70.0 public format API cannot initialize unchanged in local workerd", { timeout: 30000 }, async t => {
  const { entry } = artifact("oxfmt", "0.70.0");
  const code = await compile(`import{format}from${JSON.stringify(entry)};
    export default{async fetch(){return Response.json(await format('input.js','const  value=1',{}))}}`);
  const worker = runtime();
  try {
    const response = await worker.dispatchFetch("https://compatibility.invalid", { method: "POST", body: JSON.stringify({ code }) });
    const result = await response.json();
    assert.equal(result.loaded, false, "No formatter result or native fallback is accepted");
    assert.match(result.message, /createRequire/);
    assert.match(result.message, /file URL|argument.*path/i);
    t.diagnostic(`Pinned artifact startup rejection: ${result.message}`);
  } finally { await worker.dispose(); }
});

test("Oxlint 1.85.0 public JS entrypoint is configuration, not a Worker lint engine", { timeout: 30000 }, async () => {
  const { entry, metadata } = artifact("oxlint", "1.85.0");
  const code = await compile(`import*as tool from${JSON.stringify(entry)};
    export default{fetch(){return Response.json({exports:Object.keys(tool),lint:typeof tool.lint})}}`);
  const worker = runtime();
  try {
    const response = await worker.dispatchFetch("https://compatibility.invalid", { method: "POST", body: JSON.stringify({ code }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { loaded: true, status: 200, value: { exports: ["defineConfig"], lint: "undefined" } });
  } finally { await worker.dispose(); }
  assert.equal(metadata.bin.oxlint, "bin/oxlint");
  const cli = readFileSync(dirname(entry) + "/cli.js", "utf8");
  const binding = readFileSync(dirname(entry) + "/bindings.js", "utf8");
  assert.match(cli, /from "\.\/bindings\.js"/);
  assert.match(cli, /process\.argv/);
  assert.match(binding, /createRequire/);
  assert.match(binding, /\.node/);
});
