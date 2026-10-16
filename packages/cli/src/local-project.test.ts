import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const bin = join(root, "packages/cli/src/bin.ts")
const ci = new URL("../../ci/src/index.ts", import.meta.url).href
const service = new URL("../../cloudflare-dynamic-worker/src/project-service.ts", import.meta.url).href
const invoke = (workflow: string, command = "run") => {
  const result = spawnSync(process.execPath, [bin, command, "--workflow", workflow, "--format=json"], {
    cwd: root, encoding: "utf8", timeout: 25_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, AI_AGENT: "true", LOCAL_PROJECT_SECRET: "parent-only-canary" },
  })
  assert.equal(result.error, undefined, result.error?.message ?? "CLI subprocess must start")
  assert.doesNotMatch(result.stdout, /untrusted-console|untrusted-sensitive|parent-only-canary/)
  assert.doesNotMatch(result.stderr, /untrusted-console|untrusted-sensitive|parent-only-canary/)
  return { code: result.status, json: JSON.parse(result.stdout), stderr: result.stderr }
}
test("normal local CLI executes unchanged portable project workflow in real workerd", { timeout: 30000 }, () => {
  const result = invoke(join(root, "examples/dynamic-project-checks/.cloudflare/ci/workflow.ts"))
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.equal(result.json.location, "local")
  assert.deepEqual(result.json.plan.nodes.map((n: { status: string }) => n.status), ["complete", "complete"])
  assert.ok(result.json.plan.nodes.every((n: { commands: unknown[] }) => n.commands.length === 0))
})
test("normal CLI planning is module-free; hostile modules stay inside real workerd", { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cf-ci-local-project-")), marker = join(dir, "must-not-exist")
  const workflow = join(dir, ".cloudflare/ci/workflow.ts")
  await mkdir(join(dir, ".cloudflare/ci"), { recursive: true }); await mkdir(join(dir, "app"))
  await writeFile(join(dir, "package.json"), '{"name":"owned-local-isolate-probe","type":"module"}')
  const prepare = async (source: string, body: string, twice = false, preflight = false) => {
    await writeFile(join(dir, "app/index.js"), source)
    await writeFile(workflow, `import * as CI from ${JSON.stringify(ci)};import {ProjectChecks} from ${JSON.stringify(service)};
      const checkout=CI.action('checkout',function*(){const source=yield* CI.Source;return()=>source.checkout()});
      const check=CI.action('isolated behavior',()=>function*(){const w=yield* checkout();if((yield* CI.executionMode)==='plan')return {planned:true};
        const source=yield* w.readFile('app/index.js'),checks=${JSON.stringify([...(preflight ? [{ name: "loop preflight", path: "/preflight", status: 200, body: "ready" }] : []), { name: "owned behavior", path: "/", status: 200, body }, ...(twice ? [{ name: "fresh globals", path: "/", status: 200, body }] : [])])};
        return yield* (yield* ProjectChecks).run({mainModule:'index.js',modules:{'index.js':source},checks});});
      export default CI.workflow('local-isolate-probe',()=>check());`)
  }
  try {
    await prepare("this is deliberately invalid JavaScript and must not be loaded during planning", "ok")
    await rm(join(dir, "app/index.js"))
    const plan = invoke(workflow, "plan"); assert.equal(plan.code, 0, JSON.stringify(plan)); assert.equal(plan.json.plan.mode, "plan")
    for (const [source, body, twice] of [
      ["let n=0;export default {fetch(){return new Response(String(++n))}}", "1", true],
      ["console.log('untrusted-console');export default {fetch(){console.warn('untrusted-console');console.error('untrusted-console');return new Response('ok')}}", "ok", false],
      ["export default {fetch(req,env){return new Response(JSON.stringify(Object.keys(env)))}}", "[]", false],
      ["export default {async fetch(){try{await fetch('https://example.com');return new Response('escaped')}catch{return new Response('blocked')}}}", "blocked", false],
      ["import {connect} from 'cloudflare:sockets';export default {async fetch(){try{const s=connect('example.com:443');await s.opened;return new Response('escaped')}catch{return new Response('blocked')}}}", "blocked", false],
    ] as const) { await prepare(source, body, twice); const result = invoke(workflow); assert.equal(result.code, 0, JSON.stringify(result)) }
    for (const source of [
      `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'escaped');export default {fetch(){return new Response('ok')}}`,
      "throw new Error('untrusted-sensitive');export default {fetch(){return new Response('ok')}}",
      "export default {fetch(){console.log('untrusted-console');throw new Error('untrusted-sensitive')}}",
      "export default {fetch(){return new Response('wrong')}}",
      "export default {fetch(){return new Response('x'.repeat(4097))}}",
    ]) {
      await prepare(source, "ok"); const result = invoke(workflow)
      assert.equal(result.code, 1, JSON.stringify(result)); assert.match(result.json.error.message, /Project check failed: owned behavior/)
    }
    for (const source of [
      "export default {async fetch(){await new Promise(()=>{});return new Response('ok')}}",
      "export default {fetch(req){if(new URL(req.url).pathname==='/preflight')return new Response('ready');while(true){}}}",
    ]) {
      const loop = source.includes("while(true)")
      await prepare(source, "ok", false, loop)
      const result = invoke(workflow); assert.equal(result.code, 1, JSON.stringify(result))
      assert.match(result.json.error.message, /(?:Project check failed|Local project check timed out): owned behavior/)
    }
    await assert.rejects(access(marker), /ENOENT/)
    assert.equal(await readFile(join(dir, "package.json"), "utf8"), '{"name":"owned-local-isolate-probe","type":"module"}')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
