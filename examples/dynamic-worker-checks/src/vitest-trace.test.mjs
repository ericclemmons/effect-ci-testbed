import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import test from "node:test";

test("actual local child tail stores only outcome metadata; SQLite receipts are immutable across reload", { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url), plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const contents = `import{AssertionTail,AssertionJournal}from'./vitest-trace.ts';export{AssertionTail,AssertionJournal};
    export default{async fetch(r,env,ctx){const p=await r.json();try{
      if(p.op==='actual'){
        const child=env.LOADER.load({compatibilityDate:'2026-10-07',compatibilityFlags:[],env:{},globalOutbound:null,
          limits:{cpuMs:1000,subRequests:0},mainModule:'index.js',modules:{'index.js':"export default{fetch(){console.log('private-project-output');return new Response('ok')}}"},
          tails:[ctx.exports.AssertionTail({props:{owner:'actual-local-tail',test:0}})]}).getEntrypoint();
        const response=await child.fetch(new Request('https://child.invalid'));await response.body?.cancel();return Response.json({done:true});
      }
      const journal=ctx.exports.AssertionJournal.getByName(p.owner);
      if(p.op==='record'){await journal.record(p.value);return Response.json({done:true});}
      const value=await journal.read(p.index??0);try{return Response.json(value?JSON.parse(JSON.stringify(value)):null)}finally{value?.[Symbol.dispose]?.();}
    }catch{return Response.json({error:'rejected'},{status:422})}}};`;
  const bundle = (await build({ stdin: { contents, loader: "ts", resolveDir: new URL(".", import.meta.url).pathname }, bundle: true,
    write: false, format: "esm", platform: "neutral", external: ["cloudflare:workers"] })).outputFiles[0].text;
  const config = { name: "assertion-tail-test", compatibilityDate: "2026-10-07",
    env: { LOADER: { type: "worker-loader" } },
    exports: { AssertionTail: { type: "worker" }, AssertionJournal: { type: "durable-object", storage: "sqlite" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle } } },
  };
  const runtime = new Miniflare({ workers: [{ config }] });
  const call = async p => runtime.dispatchFetch("https://test.invalid", { method: "POST", body: JSON.stringify(p) });
  try {
    assert.equal((await call({ op: "actual" })).status, 200);
    let value;
    for (let n = 0; n < 50; n++) {
      value = await (await call({ op: "read", owner: "actual-local-tail" })).json();
      if (value) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(value, "A real platform tail callback is required, not a manufactured CPU receipt");
    assert.equal(value.owner, "actual-local-tail"); assert.equal(value.test, 0); assert.equal(value.outcome, "ok");
    assert.deepEqual(Object.keys(value).sort(), ["cpuTime", "eventTimestamp", "outcome", "owner", "test", "wallTime"]);
    assert.ok(!JSON.stringify(value).includes("private-project-output"));
    const owner = "synthetic-journal-consistency", record = { owner, test: 0, outcome: "ok", cpuTime: 1, wallTime: 2, eventTimestamp: 123 };
    assert.equal((await call({ op: "record", owner, value: record })).status, 200);
    assert.equal((await call({ op: "record", owner, value: record })).status, 200);
    for (const invalid of [{ ...record, cpuTime: 2 }, { ...record, owner: "foreign" }, { ...record, test: 16 }, { ...record, outcome: "invented" }])
      assert.equal((await call({ op: "record", owner, value: invalid })).status, 422);
    assert.deepEqual(await (await call({ op: "read", owner })).json(), record);
    await runtime.setOptions({ workers: [{ config }] });
    assert.deepEqual(await (await call({ op: "read", owner })).json(), record);
  } finally { await runtime.dispose(); }
});
