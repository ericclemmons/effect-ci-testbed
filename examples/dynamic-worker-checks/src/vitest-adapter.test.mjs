import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { realpathSync } from "node:fs";
import test from "node:test";
import { assertionRuntimeSource } from "../../../packages/cloudflare-dynamic-worker/src/assertion-source.ts";

test("bounded shared adapter executes genuine assertions, failures and fresh project modules in workerd", { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const tool = (await build({ stdin: { contents: assertionRuntimeSource, loader: "js", resolveDir: dirname(require.resolve("@vitest/expect")) },
    bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"] })).outputFiles[0].text;
  const trusted = { mainModule: "trusted/assertions.js", modules: { "trusted/assertions.js": tool } };
  const contents = `import{runPreparedProjectTests}from'../../../packages/cloudflare-dynamic-worker/src/prepared-tests.ts';
    const trusted=${JSON.stringify(trusted)};globalThis.__ownedParentMarker='private parent marker';export default{async fetch(r,env){
      try{return Response.json(await runPreparedProjectTests(env.LOADER,trusted,await r.json()))}
      catch{return Response.json({error:'Invalid tests'},{status:422})}}};`;
  const bridge = (await build({ stdin: { contents, resolveDir: new URL(".", import.meta.url).pathname, loader: "js" },
    bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"] })).outputFiles[0].text;
  const runtime = new Miniflare({ workers: [{ config: { name: "vitest-adapter-test", compatibilityDate: "2026-10-07",
    exports: {}, env: { LOADER: { type: "worker-loader" } },
    manifest: { mainModule: "bridge.js", modules: { "bridge.js": { type: "esm", contents: bridge } } },
  } }] });
  const run = async (modules, tests) => {
    const response = await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify({ mainModule: "suite.js", modules, tests }) });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    const r = await run({ "math.js": "export const plus=(a,b)=>a+b", "suite.js": `import{plus}from'./math.js';
      export function good(e){e(plus(2,3)).toBe(5);e({a:1}).toEqual({a:1});e(2).not.toBe(3)}
      export function bad(e){e(1).toBe(2)}
      export function state(e){globalThis.counter=(globalThis.counter??0)+1;e(globalThis.counter).toBe(1)}
      export function empty(){}
      export function excessive(e){for(let n=0;n<65;n++)e(1).toBe(1)}
      export function secret(){throw Error('private-token-shaped-value')}
      export async function network(e){let blocked=false;try{await fetch('https://example.com')}catch{blocked=true}e(blocked).toBe(true);e(globalThis.__ownedParentMarker).toBe(undefined)}
    ` }, [{ name: "positive", export: "good" }, { name: "negative", export: "bad" },
      { name: "state one", export: "state" }, { name: "state two", export: "state" },
      { name: "zero assertions", export: "empty" }, { name: "limit", export: "excessive" },
      { name: "redaction", export: "secret" }, { name: "network", export: "network" },
      { name: "missing export", export: "missing" }]);
    assert.equal(r.runtime, "dynamic-worker"); assert.equal(r.containers, 0); assert.equal(r.tool, "vitest-expect-5.0.3-subset");
    assert.equal(r.toolModuleCount, 1); assert.ok(r.toolBytes > 0 && r.toolBytes <= 524288);
    assert.match(r.toolDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(r.tests, [
      { name: "positive", passed: true, assertions: 3 },
      { name: "negative", passed: false, assertions: 1, failure: "assertion" },
      { name: "state one", passed: true, assertions: 1 }, { name: "state two", passed: true, assertions: 1 },
      { name: "zero assertions", passed: false, assertions: 0, failure: "execution" },
      { name: "limit", passed: false, assertions: 64, failure: "execution" },
      { name: "redaction", passed: false, assertions: 0, failure: "execution" },
      { name: "network", passed: true, assertions: 2 },
      { name: "missing export", passed: false, assertions: 0, failure: "execution" },
    ]);
    assert.ok(!JSON.stringify(r).includes("private-token-shaped-value"));
    const denied = await run({ "suite.js": "import fs from 'node:fs';export function test(e){e(fs.readFileSync('/etc/passwd','utf8')).toBe('x')}" }, [{ name: "filesystem", export: "test" }]);
    assert.deepEqual(denied.tests, [{ name: "filesystem", passed: false, assertions: 0, failure: "execution" }]);
    const unknown = await run({ "suite.js": "import secret from 'forbidden-parent-binding';export function test(e){e(secret).toBe(1)}" }, [{ name: "unprovided import", export: "test" }]);
    assert.deepEqual(unknown.tests, [{ name: "unprovided import", passed: false, assertions: 0, failure: "execution" }]);
    const process = await run({ "suite.js": "import{execFileSync}from'node:child_process';export function test(e){e(execFileSync('/usr/bin/true')).toBe(undefined)}" }, [{ name: "native process", export: "test" }]);
    assert.deepEqual(process.tests, [{ name: "native process", passed: false, assertions: 0, failure: "execution" }]);
    const invalid = await runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify({ mainModule: "suite.js", modules: { "suite.js": "bad" }, tests: [], env: {} }) });
    assert.equal(invalid.status, 422);
  } finally { await runtime.dispose(); }
});
