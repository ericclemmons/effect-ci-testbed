import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

test("real SQLite transactions serialize RPC reservations and preserve failure charges", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import {InferenceBudgetObject} from './worker.ts';
    import {MODEL} from './budget.ts';
    export class Budget extends InferenceBudgetObject {
      constructor(state,env){super(state,{AI:{run:async(model,input)=>{
        if(input.messages[0].content==='fail')throw Error('private failure');
        return {response:'proposal'};
      }}});}
      async call(run,id,fail=false) {
        return this.run(run,id,MODEL,{messages:[{role:'user',content:fail?'fail':'owned fixture'}]});
      }
      async inspect(){return this.ctx.storage.get('ledger');}
      async corrupt(){await this.ctx.storage.put('ledger',{version:2,reservations:[]});}
    }
    export default {async fetch(req,env){
      const {op,run,id,fail}=await req.json();const stub=env.BUDGET.getByName('fixed-global-budget');
      try{return Response.json(op==='inspect'?await stub.inspect():op==='corrupt'?await stub.corrupt()??null:await stub.call(run,id,fail));}
      catch(e){return Response.json({error:e.message},{status:400});}
    }};
  `, resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", sourcefile: "budget-probe.ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers"] })
  const name = "budget-probe"
  const runtime = new Miniflare({ workers: [{ config: {
    name, compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { Budget: { type: "durable-object", storage: "sqlite" } },
    env: { BUDGET: { type: "durable-object", worker: name, exportName: "Budget" } },
  } }] })
  const send = async (body: object) => {
    const response = await runtime.dispatchFetch("https://probe.invalid", { method: "POST", body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  try {
    assert.equal((await send({ run: "first", id: "lost", fail: true })).status, 400)
    assert.equal((await send({ run: "first", id: "lost" })).status, 400)
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => send({ run: `run${Math.floor(i / 4)}`, id: `call${i}` })))
    assert.equal(results.filter((result) => result.status === 200).length, 19)
    assert.equal((await send({ op: "inspect" })).body.reservations.length, 20)
    assert.equal((await send({ run: "new", id: "overflow" })).status, 400)
    await send({ op: "corrupt" })
    assert.equal((await send({ run: "new", id: "after-corruption" })).body.error, "Inference budget ledger unavailable")
  } finally { await runtime.dispose() }
})
