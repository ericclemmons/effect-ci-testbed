import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import { Notifications, notificationLayer, type Delivery } from "./notification-service.ts"
import { RunCard } from "./run-card.ts"

const card = () => new RunCard({ instanceId: "run", repository: "owner/repo", revision: "abcdef123", slackApprovalsEnabled: true })

test("one Effect service fans out independent presentations and reuses provider receipts", async () => {
  const seen: Array<string | undefined> = []
  const layer = notificationLayer([
    { id: "slack", deliver: (_run, receipt) => Effect.sync(() => {
      seen.push(receipt?.message)
      return { message: "same-slack-message" }
    }) },
    { id: "pr-comment", deliver: (run, receipt) => Effect.succeed({ comment: receipt?.comment ?? `comment-${run.identity.instanceId}` }) },
    { id: "broken", deliver: () => Effect.fail(new Error("secret webhook URL")) },
  ])
  const publish = (key: string) => Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* Notifications).publish(key, card().snapshot())
  }).pipe(Effect.provide(layer)))
  const first = await publish("started")
  const second = await publish("complete")
  assert.deepEqual(seen, [undefined, "same-slack-message"])
  assert.deepEqual(first, second)
  assert.equal(first.filter((result) => result.status === "delivered").length, 2)
  assert.deepEqual(first[2], { provider: "broken", status: "failed" })
  assert.ok(!JSON.stringify(first).includes("secret"))
})

test("checkpoint replay restores receipts and an uncertain failure blocks later writes, including after replay", async () => {
  let calls = 0
  const history = new Map<string, Delivery>()
  const makeLayer = () => notificationLayer([{ id: "slack", deliver: (_run, previous) => Effect.sync(() => {
    calls++
    if (calls === 2) throw new Error("delivery failed")
    assert.equal(previous?.message, calls === 1 ? undefined : "123")
    return { message: "123" }
  }) }], async (provider, key, deliver) => {
    const id = `${provider}:${key}`
    const previous = history.get(id)
    if (previous) return previous
    const result = await deliver()
    history.set(id, result)
    return result
  })
  const publish = (layer: ReturnType<typeof makeLayer>, key: string) => Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* Notifications).publish(key, card().snapshot())
  }).pipe(Effect.provide(layer)))
  await publish(makeLayer(), "started")
  const replay = makeLayer()
  await publish(replay, "started")
  assert.equal(calls, 1)
  assert.equal((await publish(replay, "running"))[0]?.status, "failed")
  assert.equal((await publish(replay, "complete"))[0]?.status, "failed")
  const restored = makeLayer()
  assert.equal((await publish(restored, "running"))[0]?.status, "failed")
  assert.equal((await publish(restored, "complete"))[0]?.status, "failed")
  assert.equal(calls, 2, "Failed delivery needs reconciliation, not another external POST")
})

test("semantic snapshot excludes output and approval capabilities and cannot mutate the card", () => {
  const run = card()
  run.update({ type: "step.output", workflowId: "build", stepId: "test", stream: "stdout", text: "secret output", timestamp: "now" })
  run.update({ type: "approval.requested", workflowId: "build", stepId: "release", requestId: "request", approval: { title: "Review", summary: "Private summary" }, timestamp: "now" })
  run.setReviewUrl("https://example.com/approval?token=secret-capability")
  const snapshot = run.snapshot()
  assert.equal(snapshot.phase, "waiting")
  assert.equal(snapshot.checks[0]?.status, "waiting")
  assert.ok(!JSON.stringify(snapshot).includes("secret"))
  assert.ok(!JSON.stringify(snapshot).includes("Private summary"))
  assert.ok(Object.isFrozen(snapshot.checks[0]?.dependencies))
  assert.ok(Object.isFrozen(snapshot.identity))
})

test("duplicate or unsafe checkpoint provider IDs fail configuration", () => {
  const provider = { id: "slack", deliver: () => Effect.succeed({}) }
  assert.throws(() => notificationLayer([provider, provider]), /unique/)
  assert.throws(() => notificationLayer([{ ...provider, id: "../secret" }]), /unique/)
  for (const timeoutMs of [0, -1, 20_001, NaN, Infinity])
    assert.throws(() => notificationLayer([provider], undefined, { timeoutMs }), /deadline/)
})

test("an uncertain checkpoint exception blocks only that provider for the run", async () => {
  let attempts = 0, healthy = 0
  const layer = notificationLayer([
    { id: "uncertain", deliver: () => Effect.succeed({ message: "must-not-repost" }) },
    { id: "healthy", deliver: () => Effect.sync(() => ({ message: String(++healthy) })) },
  ], async (provider, _key, deliver) => {
    if (provider === "uncertain") { attempts++; throw Error("private-transport-capability") }
    return deliver()
  })
  const publish = (key: string) => Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* Notifications).publish(key, card().snapshot())
  }).pipe(Effect.provide(layer)))
  const first = await publish("start"), last = await publish("complete")
  assert.equal(attempts, 1); assert.equal(healthy, 2)
  assert.equal(first[0]?.status, "failed"); assert.equal(last[0]?.status, "failed")
  assert.ok(!JSON.stringify([first, last]).includes("private-transport"))
})

test("a bounded provider timeout leaves healthy delivery available without a later retry", { timeout: 2000 }, async () => {
  let attempts = 0, healthy = 0
  const layer = notificationLayer([
    { id: "stalled", deliver: () => { attempts++; return Effect.never } },
    { id: "healthy", deliver: () => Effect.sync(() => ({ message: String(++healthy) })) },
  ], undefined, { timeoutMs: 20 })
  const publish = (key: string) => Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* Notifications).publish(key, card().snapshot())
  }).pipe(Effect.provide(layer)))
  const first = await publish("start"), last = await publish("complete")
  assert.equal(first[0]?.status, "failed"); assert.equal(last[0]?.status, "failed")
  assert.equal(attempts, 1); assert.equal(healthy, 2)
})
