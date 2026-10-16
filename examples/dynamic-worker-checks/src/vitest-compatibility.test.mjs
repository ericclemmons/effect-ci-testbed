import assert from "node:assert/strict";
import { builtinModules, createRequire } from "node:module";
import { dirname } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import test from "node:test";

// Genuine assertion plugin only, not a fake runner or a full Vitest claim.
// The Node host bundles text; it never evaluates the tool or project code.
const require = createRequire(import.meta.url);
const entry = require.resolve("@vitest/expect");
assert.equal(JSON.parse(readFileSync(dirname(entry) + "/../package.json", "utf8")).version, "5.0.3");
const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const compile = async body => (await build({
  stdin: { contents: `import{chai,JestChaiExpect}from${JSON.stringify(entry)};chai.use(JestChaiExpect);
    export default{async fetch(r,env){try{${body};return Response.json({passed:true})}
    catch(e){return Response.json({passed:false,errorType:e.name})}}};`,
    resolveDir: dirname(entry), loader: "js" },
  bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"],
  external: [...builtinModules, ...builtinModules.map(m => "node:" + m)], logLevel: "silent",
})).outputFiles[0].text;

test("real Vitest assertion subset detects failure in fresh capability-denied local Dynamic Workers", { timeout: 30000 }, async () => {
  const runtime = new Miniflare({ workers: [{ config: {
    name: "vitest-assertion-subset", compatibilityDate: "2026-10-07", exports: {},
    env: { LOADER: { type: "worker-loader" } },
    manifest: { mainModule: "bridge.js", modules: { "bridge.js": { type: "esm", contents: `
      export default{async fetch(r,env){const{code}=await r.json();
        if(new TextEncoder().encode(code).byteLength>350000)return new Response('oversized',{status:413});
        try{const child=env.LOADER.load({compatibilityDate:'2026-10-07',compatibilityFlags:[],
          mainModule:'index.js',modules:{'index.js':code},env:{},globalOutbound:null,
          limits:{cpuMs:1000,subRequests:0}}).getEntrypoint();
          const result=await child.fetch(new Request('https://test.invalid'));
          return Response.json({loaded:true,status:result.status,value:await result.json()});
        }catch{return Response.json({loaded:false})}}
      };` } } },
  } }] });
  const run = async code => (await runtime.dispatchFetch("https://compatibility.invalid", {
    method: "POST", body: JSON.stringify({ code }),
  })).json();
  try {
    const cases = [
      ["chai.expect(2).toBe(2);chai.expect({a:1}).toEqual({a:1});chai.expect(2).not.toBe(3)", true],
      ["chai.expect(2).toBe(3)", false],
      ["globalThis.count=(globalThis.count??0)+1;chai.expect(globalThis.count).toBe(1)", true],
      ["globalThis.count=(globalThis.count??0)+1;chai.expect(globalThis.count).toBe(1)", true],
      ["chai.expect(Object.keys(env)).toEqual([])", true],
      ["let rejected=false;try{await fetch('https://example.com')}catch{rejected=true}chai.expect(rejected).toBe(true)", true],
    ];
    for (const [body, passed] of cases) {
      const result = await run(await compile(body));
      assert.equal(result.loaded, true); assert.equal(result.status, 200);
      assert.equal(result.value.passed, passed);
      if (!passed) assert.equal(result.value.errorType, "AssertionError");
    }
    assert.deepEqual(await run("import fs from 'node:fs';export default{fetch(){return Response.json(fs.readFileSync('/etc/passwd','utf8'))}}"),
      { loaded: false }, "No Node compatibility, native filesystem or fallback execution");
  } finally { await runtime.dispose(); }
});
