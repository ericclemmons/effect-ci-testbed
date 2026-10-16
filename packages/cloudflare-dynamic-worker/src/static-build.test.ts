import assert from "node:assert/strict"
import test from "node:test"
import { runPreparedStaticBuild, staticBuildPolicy, validateStaticBuildSource } from "./prepared-static-build.ts"

test("compiler input is bounded data, not an incoming plugin/bundle or capability", () => {
  assert.equal(validateStaticBuildSource("const x: number = 1"), "const x: number = 1")
  for (const input of [null, {}, { code: "x", token: "private" }, "\0", "x".repeat(32769), "é".repeat(16385)])
    assert.throws(() => validateStaticBuildSource(input), /Invalid static build source/)
})

test("fresh empty child policy, bounded output validation and redacted failure authorize no malformed publication", async () => {
  let loads = 0
  const trusted = { mainModule: "compiler.js", modules: { "compiler.js": "host-owned tool" } }
  const source = "const x: number = 1", code = "const x = 1"
  let body: unknown = { code }, status = 200
  const loader = { load: (config: any) => {
    loads++
    assert.deepEqual(config.env, {}); assert.equal(config.globalOutbound, null)
    assert.deepEqual(config.compatibilityFlags, []); assert.equal(config.limits.subRequests, 0)
    assert.equal(config.limits.cpuMs, staticBuildPolicy.cpuMs)
    assert.deepEqual({ ...config.modules }, trusted.modules)
    return { getEntrypoint: () => ({ fetch: async (r: Request) => {
      assert.equal(await r.text(), source)
      return Response.json(body, { status })
    } }) }
  } } as unknown as WorkerLoader
  const first = await runPreparedStaticBuild(loader, trusted, source), second = await runPreparedStaticBuild(loader, trusted, source)
  assert.equal(loads, 2); assert.deepEqual(first, second); assert.equal(first.code, code)
  for (const digest of [first.sourceDigest, first.outputDigest, first.toolDigest]) assert.match(digest, /^[a-f0-9]{64}$/)
  assert.notEqual(first.sourceDigest, first.outputDigest)
  for (body of [{ code, secret: "private-upstream-token" }, null, [], { code: 1 }, { code: "\0" },
    { code: "x".repeat(32769) }, { code: "é".repeat(16385) }, { code: "x".repeat(200000) }])
    await assert.rejects(runPreparedStaticBuild(loader, trusted, source), /^Error: Static build failed; no output authorized for publication$/)
  body = { secret: "private-upstream-token" }; status = 422
  await assert.rejects(runPreparedStaticBuild(loader, trusted, source), /^Error: Static build failed; no output authorized for publication$/)
  await assert.rejects(runPreparedStaticBuild(loader, { mainModule: "../bad.js", modules: { "../bad.js": "bad" } }, source), /Invalid host compiler bundle/)
})
