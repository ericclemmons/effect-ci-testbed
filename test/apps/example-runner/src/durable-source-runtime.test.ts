import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))
const manifest = (files: unknown[]) => {
  const text = JSON.stringify({ version: 1, files })
  return { text, revision: createHash("sha256").update(text).digest("hex") }
}
const file = (path = "source.txt", base64 = btoa("immutable source\n")) => ({ path, base64, executable: false })

test("actual SQLite/RPC source revisions preserve immutable bytes, replay and storage bounds", { timeout: 30_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import {SourceRevisions,readDurableSource} from "../../../../packages/cloudflare/src/durable-source.ts";
    export class Revisions extends SourceRevisions {
      async corrupt(revision,text){await this.ctx.storage.put('revision:'+revision,new TextEncoder().encode(text));}
    }
    export default {async fetch(req,env){
      const {op,id='test',revision,text}=await req.json();const stub=env.SOURCES.getByName(id);
      try {
        if(op==='put') {const r=await stub.put(revision,new TextEncoder().encode(text));return Response.json({revision:r.revision,created:r.created});}
        if(op==='corrupt'){await stub.corrupt(revision,text);return Response.json({ok:true});}
        return Response.json(await readDurableSource(stub,revision));
      } catch(error){return Response.json({error:error.message},{status:400});}
    }};
  `, resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", sourcefile: "source-probe.ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers"] })
  const name = "durable-source-probe"
  const runtime = new Miniflare({ workers: [{ config: {
    name, compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { Revisions: { type: "durable-object", storage: "sqlite" } },
    env: { SOURCES: { type: "durable-object", worker: name, exportName: "Revisions" } },
  } }] })
  const send = async (op: string, input: object) => {
    const response = await runtime.dispatchFetch("https://probe.invalid", { method: "POST", body: JSON.stringify({ op, ...input }) })
    return { status: response.status, body: await response.json() }
  }
  try {
    const files = [file(), { path: "bin/run", base64: "AP8K", executable: true }]
    const first = manifest(files)
    const writes = await Promise.all([send("put", first), send("put", first)])
    assert.ok(writes.every(result => result.status === 200))
    assert.deepEqual(writes.map(result => result.body.created).sort(), [false, true])
    assert.deepEqual((await send("get", first)).body, files)
    const second = manifest([file("other")])
    assert.equal((await send("put", second)).body.created, true)
    assert.deepEqual((await send("get", first)).body, files, "new revision cannot replace the old revision")
    assert.equal((await send("put", { ...second, revision: first.revision })).status, 400)
    assert.equal((await send("get", { revision: "latest" })).status, 400)
    assert.equal((await send("get", { revision: "0".repeat(64) })).status, 400)
    for (const invalid of [[file("../escape")], [file(), file()], [file("app"), file("app/main")], [file("bad", "QQ")]]) {
      assert.equal((await send("put", manifest(invalid))).status, 400)
    }
    for (let i = 2; i < 32; i++) assert.equal((await send("put", manifest([file(`file${i}`)]))).status, 200)
    assert.equal((await send("put", manifest([file("overflow")]))).status, 400)
    assert.equal((await send("put", first)).body.created, false, "existing revision replay works at capacity")
    await send("corrupt", { ...second, revision: first.revision })
    assert.equal((await send("get", first)).status, 400, "read verifies persisted exact bytes, not just the storage key")
  } finally { await runtime.dispose() }
})
