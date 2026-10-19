import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import { projectPolicy, validateProject, readBoundedText, runProjectChecks } from "@effect-ci-testbed/cloudflare-dynamic-worker/project"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

test("project boundary validates before loading and pins every capability", async () => {
  let loads = 0
  const loader = { load(code: WorkerLoaderWorkerCode) {
    loads++
    assert.deepEqual(code.env, {})
    assert.equal(code.globalOutbound, null)
    assert.deepEqual(code.compatibilityFlags, [])
    assert.deepEqual(code.limits, { cpuMs: 50, subRequests: 0 })
    assert.equal(code.tails, undefined)
    return { getEntrypoint: () => ({ fetch: async () => new Response("ok") }) }
  } } as unknown as WorkerLoader
  const input = { mainModule: "index.js", modules: { "index.js": "source" }, checks: [
    { name: "first", path: "/", status: 200, body: "ok" },
    { name: "second", path: "/", status: 200, body: "ok" },
  ] }
  assert.equal((await runProjectChecks(loader, input)).passed.length, 2)
  assert.equal(loads, 2)
  for (const path of ["../index.js", "/index.js", "node:fs.js", "index.ts"]) {
    assert.throws(() => validateProject({ ...input, mainModule: path }))
  }
  await assert.rejects(runProjectChecks(loader, { ...input, modules: { "index.js": "x".repeat(projectPolicy.maxSourceBytes + 1) } }))
  assert.equal(loads, 2)
  await assert.rejects(readBoundedText(new Response("x".repeat(4097)), 4096), /exceeds limit/)
})

test("real workerd executes project modules while denying network, parent bindings and Node filesystem", { timeout: 60_000 }, async () => {
  const output = await build({ stdin: { contents: `
    import { runProjectChecks } from "../../../../packages/cloudflare-dynamic-worker/src/project-checks.ts";
    import * as Dynamic from "@effect-ci-testbed/cloudflare-dynamic-worker/project";
    import * as CI from "@effect-ci-testbed/ci";
    import * as Effect from "effect/Effect";
    import workflow from "../../../../examples/dynamic-project-checks/.cloudflare/ci/workflow.ts";
    export default { async fetch(req, env) {
      try {
        const input = await req.json();
        if (input.recipe) {
          const result = await CI.runPromise({...workflow, effect:workflow.effect.pipe(
            Effect.provideService(Dynamic.ProjectChecks, Dynamic.makeProjectChecks(env.LOADER)))}, {
            output:"silent", source:{checkout:()=>Effect.succeed(CI.Workspace.remote("source", "/fixture"))},
            workspaceFileSystem:{readFile:(_,path)=>Effect.succeed(input.modules[path.replace("app/", "")]),
              exists:()=>Effect.succeed(true)},
            executor:{execute:()=>Effect.die(new Error("No container commands"))}
          });
          return Response.json(result.plan);
        }
        return Response.json(await runProjectChecks(env.LOADER, input));
      }
      catch(error) { return Response.json({error: error.message}, {status: 422}); }
    }};
  `, resolveDir: new URL(".", import.meta.url).pathname, sourcefile: "project-host.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", target: "esnext", external: ["cloudflare:workers", "node:*"] })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "project-check-host", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "host.js", modules: { "host.js": { type: "esm", contents: output.outputFiles[0].text } } },
    env: { LOADER: { type: "worker-loader" }, SECRET: { type: "json", value: "host-only-canary" } },
  } }] })
  const send = async (source: string, body: string, extra: Record<string, string> = {}) => {
    const response = await runtime.dispatchFetch("https://host.invalid", { method: "POST", body: JSON.stringify({
      mainModule: "index.js", modules: { "index.js": source, ...extra },
      checks: [{ name: "behavior", path: "/", status: 200, body }, { name: "fresh isolate", path: "/", status: 200, body }],
    }) })
    return { status: response.status, result: await response.json() }
  }
  try {
    const { readFile } = await import("node:fs/promises")
    const recipeResponse = await runtime.dispatchFetch("https://host.invalid", { method: "POST", body: JSON.stringify({ recipe: true,
      modules: Object.fromEntries(await Promise.all(["index.js", "lib.js"].map(async name => [name, await readFile(new URL(
        `../../../../examples/dynamic-project-checks/app/${name}`, import.meta.url), "utf8")]))) }) })
    assert.equal(recipeResponse.status, 200)
    const plan = await recipeResponse.json()
    assert.deepEqual(plan.nodes.map((node: { status: string }) => node.status), ["complete", "complete"])
    assert.ok(plan.nodes.every((node: { commands: unknown[] }) => node.commands.length === 0))
    assert.equal((await send(`import { greeting } from './lib.js'; export default {fetch(){ return new Response(greeting('world')) }};`, "hello world", {
      "lib.js": `export const greeting = name => 'hello '+name;`,
    })).status, 200)
    assert.equal((await send(`let count=0; export default {fetch(){return new Response(String(++count))}};`, "1")).status, 200)
    assert.equal((await send(`export default {fetch(req,env){return new Response(JSON.stringify(Object.keys(env)))}};`, "[]")).status, 200)
    assert.equal((await send(`export default {async fetch(){try{await fetch('https://example.com'); return new Response('escaped')}catch{return new Response('blocked')}}};`, "blocked")).status, 200)
    assert.equal((await send(`import {connect} from 'cloudflare:sockets'; export default {async fetch(){try{const socket=connect('example.com:443');await socket.opened;return new Response('escaped')}catch{return new Response('blocked')}}};`, "blocked")).status, 200)
    for (const source of [
      `throw new Error('untrusted-initialization'); export default {fetch(){return new Response('ok')}};`,
      `import fs from 'node:fs'; export default {fetch(){return new Response('escaped')}};`,
      `export default {fetch(){throw new Error('untrusted-sensitive-body')}};`,
      `export default {fetch(){return new Response('x'.repeat(4097))}};`,
      `export default {fetch(){return new Response('wrong')}};`,
    ]) {
      const result = await send(source, "ok")
      assert.equal(result.status, 422)
      assert.deepEqual(result.result, { error: "Project check failed: behavior" })
    }
    assert.equal((await send(`export default {async fetch(){await new Promise(()=>{});return new Response('ok')}};`, "ok")).status, 422)
  } finally { await runtime.dispose() }
})
