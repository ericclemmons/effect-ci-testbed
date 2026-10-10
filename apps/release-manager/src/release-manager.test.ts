import assert from "node:assert/strict"
import test from "node:test"
import { ReleaseManager, deploymentAPI, RELEASE_SCRIPT, type Deployment, type ReleaseJournal } from "./release-manager.ts"
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`
const previous = [{ version: id(1), percentage: 80 }, { version: id(2), percentage: 20 }]
function harness() {
  let journal: ReleaseJournal | undefined
  let current: Deployment = { id: id(10), versions: previous }
  let writes = 0
  let lostAck = false
  let noWrite = false
  const manager = () => new ReleaseManager({ read: async () => structuredClone(journal), write: async (value) => { journal = structuredClone(value) } }, {
    latest: async () => structuredClone(current),
    create: async (versions, message) => {
      assert.ok(journal?.pending, "intent persisted before API write")
      writes++
      if (!noWrite) current = { id: id(10 + writes), versions, message }
      if (lostAck || noWrite) throw new Error("lost acknowledgement")
      return current
    },
  })
  return { manager, writes: () => writes, journal: () => journal!, drift: () => { current = { id: id(999), versions: previous } },
    lose: () => { lostAck = true }, noWrite: () => { noWrite = true } }
}
test("ordered phases retain the baseline split, successful replay never redeploys", async () => {
  const h = harness(); const m = h.manager()
  await m.begin("run", id(3))
  await assert.rejects(m.promote("run", 25), /in order/)
  for (const percentage of [10, 25, 75, 100]) {
    const value = await m.promote("run", percentage)
    assert.equal(value.deployment.versions.at(-1)?.percentage, percentage)
    await m.promote("run", percentage)
  }
  assert.equal(h.writes(), 4)
  assert.equal((await m.complete("run")).status, "complete")
  await assert.rejects(m.rollback("run"), /terminal/)
})
test("rollback restores every previous version and another owner cannot mutate", async () => {
  const h = harness(); const m = h.manager()
  await m.begin("run", id(3))
  await assert.rejects(m.begin("other", id(4)), /owns/)
  await assert.rejects(m.promote("other", 10), /ownership/)
  await m.promote("run", 10)
  const result = await m.rollback("run")
  assert.deepEqual(result.deployment.versions, previous)
  await m.rollback("run")
  assert.equal(h.writes(), 2)
})
test("restart reconciles a lost acknowledgement without retrying the deployment write", async () => {
  const h = harness(); await h.manager().begin("run", id(3)); h.lose()
  await assert.rejects(h.manager().promote("run", 10), /lost acknowledgement/)
  assert.ok(h.journal().pending)
  assert.equal((await h.manager().promote("run", 10)).phase, 0)
  assert.equal(h.writes(), 1)
  assert.equal(h.journal().pending, undefined)
})
test("unresolved writes and external drift fail closed, including rollback", async () => {
  const h = harness(); await h.manager().begin("run", id(3)); h.noWrite()
  await assert.rejects(h.manager().promote("run", 10))
  await assert.rejects(h.manager().promote("run", 10), /operator review/)
  await assert.rejects(h.manager().rollback("run"), /operator review/)
  assert.equal(h.writes(), 1)
  const drift = harness(); await drift.manager().begin("run", id(3)); drift.drift()
  await assert.rejects(drift.manager().promote("run", 10), /drift/)
  await assert.rejects(drift.manager().rollback("run"), /drift/)
  assert.equal(drift.writes(), 0)
})
test("fixed endpoint transport never redirects, forces or leaks API errors", async () => {
  let calls = 0
  const api = deploymentAPI(() => "secret", (async (url, init) => {
    calls++
    assert.equal(new URL(String(url)).pathname.split("/").at(-2), RELEASE_SCRIPT)
    assert.equal(init?.redirect, "manual")
    assert.equal(new URL(String(url)).searchParams.has("force"), false)
    throw new Error("secret from transport")
  }) as typeof fetch)
  await assert.rejects(api.latest(), (error: Error) => !error.message.includes("secret"))
  assert.equal(calls, 1)
})

test("redirect responses are rejected without forwarding credentials", async () => {
  let calls = 0
  const api = deploymentAPI(() => "secret", (async (_url, init) => {
    calls++
    assert.equal(init?.redirect, "manual")
    return new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } })
  }) as typeof fetch)
  await assert.rejects(api.latest(), /HTTP 302/)
  assert.equal(calls, 1)
})

test("failed intent persistence prevents any deployment mutation", async () => {
  let journal: ReleaseJournal | undefined
  let calls = 0
  const m = new ReleaseManager({
    read: async () => journal,
    write: async (value) => { if (value.pending) throw new Error("storage unavailable"); journal = structuredClone(value) },
  }, { latest: async () => ({ id: id(10), versions: previous }), create: async () => { calls++; throw new Error("must not write") } })
  await m.begin("run", id(3))
  await assert.rejects(m.promote("run", 10), /storage unavailable/)
  assert.equal(calls, 0)
})

test("write confirmation reads the active allocation rather than trusting a minimal acknowledgement", async () => {
  const versions = [{ version: id(1), percentage: 90 }, { version: id(3), percentage: 10 }]
  const apiValue = { id: id(11), versions: versions.map((entry) => ({ version_id: entry.version, percentage: entry.percentage })), annotations: { "workers/message": "owned-operation" } }
  const api = deploymentAPI(() => "secret", (async (url, init) => {
    if (init?.method === "POST") {
      assert.deepEqual(JSON.parse(String(init.body)), { strategy: "percentage", versions: apiValue.versions, annotations: apiValue.annotations })
      return Response.json({ success: true, result: { id: apiValue.id } })
    }
    assert.equal(new URL(String(url)).searchParams.get("per_page"), "1")
    return Response.json({ success: true, result: { deployments: [apiValue] } })
  }) as typeof fetch)
  assert.deepEqual(await api.latest(), { id: id(11), versions, message: "owned-operation" })
  assert.deepEqual(await api.create(versions, "owned-operation"), await api.latest())
})
