import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import { makeLocalProjectChecks, LocalIsolateUnavailable } from "./local.ts"

const request = { mainModule: "index.js", modules: { "index.js": "untrusted source stays data" },
  checks: [{ name: "owned assertion", path: "/", status: 200, body: "ok" }] }
test("local capability is lazy, bounded before startup and disposed once", async () => {
  let starts = 0, disposals = 0, calls = 0
  const local = makeLocalProjectChecks({ start: async () => {
    starts++
    return { async request(body) {
      calls++; assert.deepEqual(JSON.parse(body), request)
      return new Response(JSON.stringify({ runtime: "dynamic-worker", passed: ["owned assertion"], containers: 0 }))
    }, async dispose() { disposals++ } }
  } })
  assert.equal(starts, 0)
  await assert.rejects(Effect.runPromise(local.service.run({ ...request, mainModule: "../escape.js" })), /Invalid project module manifest/)
  assert.equal(starts, 0)
  for (let i = 0; i < 2; i++) assert.equal((await Effect.runPromise(local.service.run(request))).runtime, "dynamic-worker")
  assert.equal(starts, 1); assert.equal(calls, 2)
  await local.dispose(); await local.dispose(); assert.equal(disposals, 1)
  await assert.rejects(Effect.runPromise(local.service.run(request)), /scope is closed/)
  const never = makeLocalProjectChecks({ start: async () => { throw Error("Must not boot for planning") } })
  await never.dispose()
})
test("unsupported local capability is actionable and cannot leak startup internals or fall back to Node", async () => {
  const local = makeLocalProjectChecks({ start: async () => { throw Error("private-startup-secret") } })
  try {
    await assert.rejects(Effect.runPromise(local.service.run(request)), error => {
      const message = String(error)
      assert.match(message, /workerd with WorkerLoader and loopback/)
      assert.match(message, /never fall back to Node/)
      assert.doesNotMatch(message, /private-startup-secret/)
      return true
    })
    assert.equal(new LocalIsolateUnavailable().code, "CI_LOCAL_ISOLATE_UNAVAILABLE")
  } finally { await local.dispose() }
})
test("local bridge rejects forged or unexpected result/exception text", async () => {
  for (const result of [{ runtime: "node", passed: ["owned assertion"], containers: 0 },
    { runtime: "dynamic-worker", passed: ["untrusted assertion"], containers: 0 }]) {
    const local = makeLocalProjectChecks({ start: async () => ({ request: async () => new Response(JSON.stringify(result)), dispose: async () => {} }) })
    try { await assert.rejects(Effect.runPromise(local.service.run(request)), /Invalid local isolate proof/) }
    finally { await local.dispose() }
  }
  const local = makeLocalProjectChecks({ start: async () => ({ request: async () => new Response(JSON.stringify({ error: "untrusted-sensitive-body" }), { status: 422 }), dispose: async () => {} }) })
  try { await assert.rejects(Effect.runPromise(local.service.run(request)), /Isolated project assertions failed/) }
  finally { await local.dispose() }
})
test("a nonresponding local runtime is terminated by the Node watchdog", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let disposals = 0
  const local = makeLocalProjectChecks({ start: async () => ({ request: () => new Promise(() => {}), dispose: async () => { disposals++ } }) })
  const failed = Effect.runPromise(local.service.run(request))
  const rejection = assert.rejects(failed, /Local project check timed out: owned assertion; workerd scope terminated/)
  await new Promise<void>(resolve => setImmediate(resolve))
  t.mock.timers.tick(6000)
  await rejection
  await local.dispose(); assert.equal(disposals, 1)
})
