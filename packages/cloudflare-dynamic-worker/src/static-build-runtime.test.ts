import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { dirname } from "node:path"
import { realpathSync } from "node:fs"
import test from "node:test"
import { staticBuildToolSource } from "./static-build-source.ts"

test("actual local fresh Dynamic Worker compiles bounded TypeScript without project execution or parent capabilities", { timeout: 15000 }, async () => {
  const require = createRequire(import.meta.url)
  const plugin = realpathSync(new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url))
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }))
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }))
  const bundler = realpathSync(new URL("../node_modules/@cloudflare/worker-bundler", import.meta.url))
  const compiler = require.resolve("sucrase", { paths: [bundler] })
  assert.equal(require(require.resolve("sucrase/package.json", { paths: [bundler] })).version, "3.35.1")
  // Local host preparation differs: esbuild bundles only the exact compiler,
  // never project input. Native worker-bundler preparation is not proved here.
  const tool = (await build({ stdin: { contents: staticBuildToolSource, loader: "js", resolveDir: dirname(compiler) },
    bundle: true, write: false, format: "esm", platform: "browser", conditions: ["browser", "import"], minify: true })).outputFiles[0].text
  const hostCanary = new URL("../package.json", import.meta.url).pathname
  const bridge = (await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import { runPreparedStaticBuild } from './prepared-static-build.ts';
    const tool=${JSON.stringify(tool)};
    export default{async fetch(r,env){const p=await r.json();let source=tool;
      // TEST-ONLY host prepared capability probes; not public compiler/plugin input.
      if(p.probe==='bindings')source='export default{fetch(r,env){return Response.json({code:JSON.stringify(Object.keys(env))})}}';
      if(p.probe==='network')source='export default{async fetch(){let code="allowed";try{await fetch("https://effect-ci-denied.invalid/")}catch{code="denied"}return Response.json({code})}}';
      if(p.probe==='host-file')source=${JSON.stringify(`export default{async fetch(){let code="allowed";try{(await import('node:fs')).readFileSync(${JSON.stringify(hostCanary)},'utf8')}catch{code="denied"}return Response.json({code})}}`)};
      if(p.probe==='native-process')source='export default{async fetch(){let code="allowed";try{(await import("node:child_process")).execSync("true")}catch{code="denied"}return Response.json({code})}}';
      if(p.probe==='fresh')source='let calls=0;export default{fetch(){return Response.json({code:String(++calls)})}}';
      try{return Response.json(await runPreparedStaticBuild(env.LOADER,{mainModule:'compiler.js',modules:{'compiler.js':source}},p.source??''));}
      catch{return new Response('Static build failed; no output authorized for publication',{status:422});}
    }};` }, bundle: true, write: false, format: "esm", target: "esnext" })).outputFiles[0].text
  const runtime = new Miniflare({ workers: [{ config: { name: "static-build-local", compatibilityDate: "2026-10-07",
    compatibilityFlags: [], manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bridge } } },
    env: { LOADER: { type: "worker-loader" }, FAKE_PARENT_SECRET: { type: "text", value: "non-secret-parent-canary" } },
  } }] })
  const call = (input: unknown) => runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(input) })
  try {
    const source = 'const message: string = "Built without a container"; document.querySelector("#result").textContent = message;'
    const response = await call({ source }); assert.equal(response.status, 200)
    const result = await response.json()
    assert.ok(!result.code.includes(": string")); assert.ok(result.code.includes("Built without a container"))
    assert.equal(result.tool, "sucrase-3.35.1-typescript"); assert.equal(result.containers, 0)
    assert.notEqual(result.sourceDigest, result.outputDigest); assert.match(result.toolDigest, /^[a-f0-9]{64}$/)
    const hostile = await call({ source: 'throw Error("MUST NOT EXECUTE"); const x: number = 1;' })
    assert.equal(hostile.status, 200); assert.ok((await hostile.json()).code.includes("MUST NOT EXECUTE"))
    for (const probe of ["network", "host-file", "native-process"]) {
      const r = await call({ probe }); assert.equal(r.status, 200); assert.equal((await r.json()).code, "denied", probe)
    }
    assert.equal((await (await call({ probe: "bindings" })).json()).code, "[]")
    for (let i = 0; i < 2; i++) assert.equal((await (await call({ probe: "fresh" })).json()).code, "1")
    for (const invalid of ["const = ;", "x".repeat(32769), "\0"]) {
      const r = await call({ source: invalid }); assert.equal(r.status, 422)
      assert.equal(await r.text(), "Static build failed; no output authorized for publication")
    }
  } finally { await runtime.dispose() }
})
