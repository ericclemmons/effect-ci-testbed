import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "./index.ts"
import * as Effect from "effect/Effect"

const event = (i = 0): CI.RuntimeEvent => ({ type: "step.output", workflowId: "owned", stepId: "business",
  stream: "stderr", text: "secret output must not be delivered", timestamp: String(i) })

test("throw, rejection and timeout are redacted, independently bounded and quarantined", async () => {
  let throws = 0, rejects = 0, stalls = 0, healthy = 0, aborted = false
  const observers = CI.makeRuntimeObservers([
    { id: "throws", deliver() { throws++; throw Error("secret endpoint") } },
    { id: "rejects", deliver() { rejects++; return Promise.reject(Error("secret token")) } },
    { id: "stalls", deliver(_, signal) { stalls++; signal.addEventListener("abort", () => { aborted = true }); return new Promise(() => {}) } },
    { id: "healthy", deliver(value) { healthy++; assert.ok(Object.isFrozen(value)); assert.equal("text" in value, false) } },
  ], 10)
  await Promise.all([observers.publish(event()), observers.publish(event(1))])
  assert.deepEqual([throws, rejects, stalls, healthy, aborted], [1, 1, 1, 2, true])
  const receipt = observers.snapshot()
  for (const [id, status] of [["throws", "failed"], ["rejects", "failed"], ["stalls", "timeout"]]) {
    assert.deepEqual(receipt.receipts.filter(r => r.observer === id).map(r => r.status), [status, "blocked"])
  }
  assert.equal(JSON.stringify(receipt).includes("secret"), false)
})

test("observers cannot replace success, original business failure, or trigger rollback", async () => {
  for (const fail of [false, true]) {
    let rolledBack = 0, runs = 0, conclusion: string | undefined
    const rollback = CI.action<void>("rollback", () => function* () { rolledBack++ })
    const first = CI.action<number>("first", () => function* () { return 1 }, { rollback })
    const original = Error("Original business failure")
    const business = CI.action<string>("business", () => function* () { runs++; if (fail) return yield* Effect.fail(original); return "done" })
    const workflow = CI.workflow("observer-isolation", function* () { yield* first(); return yield* business() })
    const observers = CI.makeRuntimeObservers([{ id: "broken", deliver() { throw Error("Observer defect") } }], 10)
    const promise = CI.runPromise(workflow, { output: "silent", observers, onAttempt(attempt) { conclusion = attempt.conclusion } })
    if (fail) await assert.rejects(promise, /Original business failure/)
    else assert.equal((await promise).value, "done")
    assert.equal(conclusion, fail ? "failure" : "success")
    assert.equal(runs, 1)
    assert.equal(rolledBack, fail ? 1 : 0)
    assert.equal(observers.snapshot().receipts.filter(r => r.status === "failed").length, 1)
  }
})

test("required onEvent/onAttempt failures and approval rejection still fail closed", async () => {
  const workflow = CI.workflow("required", () => "done")
  const observers = CI.makeRuntimeObservers([{ id: "broken", deliver() { throw Error("presentation") } }])
  await assert.rejects(CI.runPromise(workflow, { output: "silent", observers, onEvent() { throw Error("Required event persistence") } }), /Required event persistence/)
  assert.equal(observers.snapshot().receipts.length, 0)
  await assert.rejects(CI.runPromise(workflow, { output: "silent", observers, onAttempt() { throw Error("Required attempt persistence") } }), /Required attempt persistence/)
  const review = CI.action<void>("review", () => function* () {
    yield* (yield* CI.Approval).request({ title: "Owned review", summary: "Never approve on missing notification" })
  })
  const gated = CI.workflow("required-review", () => review())
  await assert.rejects(CI.runPromise(gated, { output: "silent", observers,
    approval: { request: () => Effect.succeed({ decision: "rejected" as const }) } }), /rejected/)
  await assert.rejects(CI.runPromise(gated, { output: "silent", observers, ci: true }), /approval|Approval/)
})

test("presentation failure does not consume or add business retries", async () => {
  let calls = 0
  const action = CI.action<string>("retry-business", () => function* () {
    calls++
    if (calls === 1) return yield* Effect.fail(Error("Retryable business error"))
    return "recovered"
  }, { retries: { limit: 1, delay: 1 } })
  const observers = CI.makeRuntimeObservers([{ id: "broken", deliver() { throw Error("Do not retry business") } }])
  const result = await CI.runPromise(CI.workflow("retry-contract", () => action()), { output: "silent", observers })
  assert.equal(result.value, "recovered")
  assert.equal(calls, 2)
  assert.equal(observers.snapshot().receipts.filter(r => r.status === "failed").length, 1)
})

test("delivery and diagnostic bounds do not reopen failed destinations", async () => {
  let calls = 0
  const observers = CI.makeRuntimeObservers([{ id: "healthy", deliver() { calls++ } }])
  for (let i = 0; i < 260; i++) await observers.publish(event(i))
  assert.equal(calls, 256)
  assert.deepEqual({ size: observers.snapshot().receipts.length, dropped: observers.snapshot().droppedEvents }, { size: 256, dropped: 4 })
  assert.throws(() => CI.makeRuntimeObservers([{ id: "same", deliver() {} }, { id: "same", deliver() {} }]))
  for (const timeout of [0, -1, 20_001, NaN]) assert.throws(() => CI.makeRuntimeObservers([], timeout))
  const many = CI.makeRuntimeObservers([{ id: "a", deliver() {} }, { id: "b", deliver() {} }])
  for (let i = 0; i < 256; i++) await many.publish(event(i))
  assert.equal(many.snapshot().receipts.length, 256)
  assert.equal(many.snapshot().omittedReceipts, 256)
})
