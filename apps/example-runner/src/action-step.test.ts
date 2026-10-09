import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers"
import { makeActionExecutor } from "../../../packages/cloudflare/src/action-step.ts"

const native = () => {
  const cache = new Map<string, unknown>()
  const attempts: Array<{ name: string; attempt: number; success: boolean }> = []
  const configs = new Map<string, WorkflowStepConfig>()
  const step = {
    async do(name: string, config: WorkflowStepConfig, callback: (context: { attempt: number }) => Promise<unknown>) {
      configs.set(name, config)
      if (cache.has(name)) return JSON.parse(JSON.stringify(cache.get(name)))
      for (let attempt = 1; ; attempt++) {
        try {
          const value = await callback({ attempt })
          attempts.push({ name, attempt, success: true })
          cache.set(name, JSON.parse(JSON.stringify(value)))
          return value
        } catch (error) {
          attempts.push({ name, attempt, success: false })
          if (attempt > (config.retries?.limit ?? 0)) throw error
        }
      }
    },
  } as unknown as Pick<WorkflowStep, "do">
  return { step, attempts, configs }
}

test("pure Effect bodies retry natively and replay without repeating work", async () => {
  const { step, attempts, configs } = native()
  const active = new Set<string>()
  let calls = 0
  const flaky = CI.action<void>("flaky", () => function* () {
    calls++
    const attempt = yield* CI.Attempt
    assert.ok(active.has("flaky"))
    if (attempt < 3) return yield* Effect.fail(new Error("transient"))
  }, { retries: { limit: 2, delay: 0, backoff: "constant" } })
  const workflow = CI.workflow("pure-policy", () => flaky())
  const options = { output: "silent" as const, actionExecutor: makeActionExecutor(step, active) }
  await CI.runPromise(workflow, options)
  await CI.runPromise(workflow, options)
  assert.equal(calls, 3)
  assert.deepEqual(attempts.map((entry) => entry.success), [false, false, true])
  assert.equal(configs.get('action:"flaky"')?.retries?.limit, 2)
  assert.equal(active.size, 0)
})

test("dependencies resolve outside the body boundary; workspace outputs and command plans survive replay", async () => {
  const { step, attempts } = native()
  const active = new Set<string>()
  let preparations = 0
  let commits = 0
  let executions = 0
  let observedOutput = 0
  const prepare = CI.action("prepare", () => () => Effect.sync(() => { preparations++; return CI.Workspace.remote("fixture", "/workspace") }))
  const build = CI.action("build", function* () {
    assert.equal(active.size, 0)
    const workspace = yield* prepare()
    return () => workspace.exec("build")
  }, { retries: { limit: 1, delay: 0 } })
  const workflow = CI.workflow("workspace-policy", () => build())
  const options: CI.RunOptions = {
    output: "silent",
    actionExecutor: makeActionExecutor(step, active),
    onEvent: (event) => {
      assert.equal(active.size, 0, "reporting must remain outside native bodies")
      if (event.type === "step.output") observedOutput++
    },
    executor: { handlesStepOptions: true, execute: () => Effect.sync(() => {
      assert.ok(active.has("build")); executions++
      return { exitCode: 0, stdout: "built", stderr: "" }
    }) },
    workspacePersistence: {
      commit: ({ stepId, workspace }) => Effect.sync(() => {
        if (stepId === "build") { commits++; assert.ok(active.has("build")) }
        return workspace.withRevision({ provider: "fixture", value: { id: "snapshot" } })
      }),
      checkpoint: () => Effect.die("not used"),
      restore: () => Effect.die("not used"),
    },
  }
  const first = await CI.runPromise(workflow, options)
  const replay = await CI.runPromise(workflow, options)
  assert.equal(preparations, 2, "dependency orchestration is reconstructed outside the native body")
  assert.equal(executions, 1)
  assert.equal(commits, 1)
  assert.ok(replay.value instanceof CI.Workspace)
  assert.deepEqual(replay.value.revision, first.value.revision)
  assert.deepEqual(replay.plan, first.plan)
  assert.equal(attempts.length, 1)
  assert.equal(observedOutput, 2, "command output is retained and reported on replay")
})

test("timeout interrupts the Effect fiber and never commits a late result", async () => {
  const { step, attempts, configs } = native()
  const active = new Set<string>()
  let finished = false
  const slow = CI.action<void>("slow", () => () => Effect.sleep("100 millis").pipe(
    Effect.andThen(Effect.sync(() => { finished = true })),
  ), { timeout: 5 })
  await assert.rejects(CI.runPromise(CI.workflow("timeout", () => slow()), {
    output: "silent", actionExecutor: makeActionExecutor(step, active),
  }))
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(finished, false)
  assert.equal(active.size, 0)
  assert.equal(attempts.length, 1)
  assert.equal(configs.get('action:"slow"')?.timeout, 5)
})

test("a failed final checkpoint retries the body instead of caching incomplete success", async () => {
  const { step, attempts } = native()
  const active = new Set<string>()
  let executions = 0
  let commits = 0
  const prepare = CI.action("prepare", () => () => Effect.succeed(CI.Workspace.remote("fixture", "/workspace")))
  const build = CI.action("build", function* () {
    const workspace = yield* prepare()
    return () => workspace.exec("build")
  }, { retries: { limit: 1, delay: 0 } })
  const options: CI.RunOptions = {
    output: "silent",
    actionExecutor: makeActionExecutor(step, active),
    executor: { handlesStepOptions: true, execute: () => Effect.sync(() => {
      executions++
      return { exitCode: 0, stdout: "built", stderr: "" }
    }) },
    workspacePersistence: {
      commit: ({ stepId, workspace }) => Effect.suspend(() => {
        if (stepId !== "build") return Effect.succeed(workspace)
        assert.ok(active.has("build"))
        if (++commits === 1) return Effect.fail(new Error("snapshot unavailable"))
        return Effect.succeed(workspace.withRevision({ provider: "fixture", value: { id: "snapshot" } }))
      }),
      checkpoint: () => Effect.die("not used"),
      restore: () => Effect.die("not used"),
    },
  }
  const workflow = CI.workflow("checkpoint-policy", () => build())
  const result = await CI.runPromise(workflow, options)
  await CI.runPromise(workflow, options)
  assert.equal(executions, 2)
  assert.equal(commits, 2)
  assert.deepEqual(attempts.map((entry) => entry.success), [false, true])
  assert.equal(result.plan.nodes.find((node) => node.id === "build")?.commands.length, 1)
  assert.ok(result.value.revision)
  assert.equal(active.size, 0)
})

test("late dependencies fail explicitly instead of nesting checkpoints", async () => {
  const { step } = native()
  let dependencies = 0
  const dependency = CI.action<void>("dependency", () => () => Effect.sync(() => { dependencies++ }))
  const bad = CI.action<void>("bad", () => function* () { yield* dependency() }, { timeout: 1000 })
  await assert.rejects(CI.runPromise(CI.workflow("guard", () => bad()), {
    output: "silent", actionExecutor: makeActionExecutor(step, new Set()),
  }), /Resolve dependency dependency during action construction/)
  assert.equal(dependencies, 0)
})

test("native boundary preserves the original error for provider non-retryable classification", async () => {
  const original = new Error("terminal")
  let received: unknown
  const step = { async do(_name: string, _config: WorkflowStepConfig, callback: (context: { attempt: number }) => Promise<unknown>) {
    try { return await callback({ attempt: 1 }) }
    catch (error) { received = error; throw error }
  } } as unknown as Pick<WorkflowStep, "do">
  const fail = CI.action<void>("fail", () => () => Effect.fail(original), { retries: { limit: 10, delay: 0 } })
  await assert.rejects(CI.runPromise(CI.workflow("terminal", () => fail()), {
    output: "silent", actionExecutor: makeActionExecutor(step, new Set()),
  }))
  assert.equal(received, original)
})
