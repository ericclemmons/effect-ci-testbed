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

test("checkpoint replay restores receipts without posting and failure preserves prior receipt", async () => {
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
  assert.equal((await publish(replay, "complete"))[0]?.status, "delivered")
  assert.equal(calls, 3)
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
})
