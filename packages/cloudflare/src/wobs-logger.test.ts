import { test } from "node:test"
import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
import { wobsLoggerLayer, withWobsLogging } from "./wobs-logger.ts"
import { makeActionExecutor } from "./action-step.ts"

test("host logger preserves levels/context and redacts secrets without invoking getters", async () => {
  const records: { level: string; record: any }[] = []
  const sink = Object.fromEntries(["debug", "info", "warn", "error"].map(level => [level, (record: any) => records.push({ level, record })])) as any
  const payload = { token: "cap", nested: { value: "host-secret" }, masked: Redacted.make("hidden-value"),
    get dangerous() { throw new Error("getter must not execute") } }
  await Effect.runPromise(Effect.gen(function* () {
    yield* Effect.logInfo("ok", payload)
    yield* Effect.logWarning("retry")
    yield* Effect.logError(new Error("host-secret https://example.test/?token=cap"))
  }).pipe(Effect.annotateLogs({ "ci.step": "build", "ci.attempt": 2 }),
    Effect.provide(wobsLoggerLayer({ workflow: "ci", instance: "run" }, { API_TOKEN: "host-secret" }, sink))))
  assert.deepEqual(records.map(record => record.level), ["info", "warn", "error"])
  assert.ok(records.every(({ record }) => record.step === "build" && record.attempt === 2 && record.instance === "run"))
  const json = JSON.stringify(records)
  assert.ok(!json.includes("host-secret") && !json.includes("hidden-value") && !json.includes("token=cap"))
  assert.ok(json.includes("<accessor>") && json.includes("<redacted>"))
})

test("native retry fibers retain the host logger and actual attempt", async () => {
  const records: any[] = []
  const sink = { debug() {}, info(record: any) { records.push(record) }, warn() {}, error() {} }
  const executor = makeActionExecutor({ do: async (_name: any, _options: any, body: any) => {
    try { return await body({ attempt: 1 }) } catch { return body({ attempt: 2 }) }
  } } as any, new Set())
  const result = await Effect.runPromise(executor.execute({ stepId: "flaky", options: { retries: { limit: 1, delay: 0 } },
    run: (attempt: number) => Effect.logInfo("attempt").pipe(Effect.andThen(attempt === 1 ? Effect.fail(new Error("retry"))
      : Effect.succeed({ value: "done", commands: [] }))) } as any)
    .pipe(Effect.provide(wobsLoggerLayer({ workflow: "ci", instance: "retry" }, {}, sink))) as Effect.Effect<any, unknown>)
  assert.equal(result.value, "done")
  assert.deepEqual(records.map(record => [record.step, record.attempt]), [["flaky", 1], ["flaky", 2]])
})

test("terminal error identity survives logging, including a failing console sink", async () => {
  const error = new Error("original terminal error")
  const sink = { debug() { throw 1 }, info() { throw 1 }, warn() { throw 1 }, error() { throw 1 } }
  const exit = await Effect.runPromiseExit(Effect.fail(error).pipe(Effect.tapCause(cause => Effect.logError(cause)),
    Effect.provide(wobsLoggerLayer({ workflow: "ci", instance: "terminal" }, {}, sink))))
  assert.ok(Exit.isFailure(exit))
  assert.equal(Cause.squash(exit.cause), error)
  const wrapped = await Effect.runPromiseExit(withWobsLogging(Effect.fail(error), { workflow: "ci", instance: "terminal" }))
  assert.ok(Exit.isFailure(wrapped))
  assert.equal(Cause.squash(wrapped.cause), error)
})

test("structured causes keep searchable errors while payloads remain bounded", async () => {
  const records: any[] = []
  const sink = { debug() {}, info(record: any) { records.push(record) }, warn() {}, error(record: any) { records.push(record) } }
  const large = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => "x".repeat(10000)))
  await Effect.runPromise(Effect.logInfo(large).pipe(Effect.provide(wobsLoggerLayer({ workflow: "ci", instance: "bounded" }, {}, sink))))
  const error = new Error("searchable-terminal-marker")
  await Effect.runPromiseExit(Effect.fail(error).pipe(Effect.tapCause(cause => Effect.logError("terminal", cause)),
    Effect.provide(wobsLoggerLayer({ workflow: "ci", instance: "bounded" }, {}, sink))))
  assert.ok(JSON.stringify(records[0]).length < 16000)
  assert.ok(JSON.stringify(records[1]).includes("searchable-terminal-marker"))
})

test("unavailable secret inventory suppresses payloads once without replacing outcomes or calling getters", async () => {
  for (const environment of [
    new Proxy({}, { ownKeys() { throw new Error("inventory unavailable") } }),
    { get API_TOKEN() { throw new Error("must not invoke secret getter") } },
  ]) {
    const records: any[] = []
    const sink = { debug(record: any) { records.push(record) }, info(record: any) { records.push(record) },
      warn(record: any) { records.push(record) }, error(record: any) { records.push(record) } }
    const original = new Error("sensitive-business-error")
    const exit = await Effect.runPromiseExit(Effect.logInfo("sensitive-user-payload").pipe(
      Effect.andThen(Effect.fail(original)), Effect.tapCause(cause => Effect.logError(cause)),
      Effect.provide(wobsLoggerLayer({ workflow: "sensitive-context", instance: "sensitive-context" }, environment, sink))))
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.squash(exit.cause), original)
    assert.deepEqual(records, [{ source: "effect-ci", level: "Warn", message: "Effect diagnostics suppressed: secret inventory unavailable" }])
  }
})
