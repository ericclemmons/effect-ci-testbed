import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers"
import { makeActionExecutor } from "../../../packages/cloudflare/src/action-step.ts"
import rollbackWorkflow from "../../../examples/rollback-compensation/.cloudflare/ci/workflow.ts"

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

test("a failed final checkpoint recomputes lost files instead of caching incomplete success", async () => {
  const { step, attempts } = native()
  const active = new Set<string>()
  let executions = 0
  let commits = 0
  let liveOutput: string | undefined
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
      liveOutput = `built-${executions}`
      return { exitCode: 0, stdout: "built", stderr: "" }
    }) },
    workspacePersistence: {
      commit: ({ stepId, workspace }) => Effect.suspend(() => {
        if (stepId !== "build") return Effect.succeed(workspace)
        assert.ok(active.has("build"))
        if (++commits === 1) {
          assert.equal(liveOutput, "built-1")
          liveOutput = undefined
          return Effect.fail(new Error("snapshot unavailable after filesystem loss"))
        }
        assert.equal(liveOutput, "built-2", "the body must rebuild before committing")
        return Effect.succeed(workspace.withRevision({ provider: "fixture", value: { id: "snapshot", output: liveOutput } }))
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
  assert.deepEqual(result.value.revision.value, { id: "snapshot", output: "built-2" })
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

test("the consumer rollback runs once outside the exhausted native body and preserves failure", async () => {
  const { step, attempts } = native()
  const active = new Set<string>()
  let rollbacks = 0
  await assert.rejects(CI.runPromise(rollbackWorkflow, {
    output: "silent", actionExecutor: makeActionExecutor(step, active),
    source: { checkout: () => Effect.succeed(CI.Workspace.remote("fixture", "/workspace")) },
    executor: {
      handlesStepOptions: true,
      execute: ({ command, stepId, workspace }) => Effect.suspend(() => {
        if (command === "echo deploy") {
          assert.ok(active.has("deploy with retries"))
          return Effect.fail(new CI.CommandError(stepId, command, workspace.cwd, 7, "expected failure"))
        }
        assert.equal(active.size, 0)
        assert.equal(command, "echo rollback")
        rollbacks++
        return Effect.succeed({ exitCode: 0, stdout: "rollback", stderr: "" })
      }),
    },
  }), /expected failure/)
  assert.deepEqual(attempts.map((entry) => entry.success), [false, false, false])
  assert.equal(rollbacks, 1)
  assert.equal(active.size, 0)
})

test("native policy bodies unwind completed actions in reverse order after a later failure", async () => {
  const { step, attempts } = native()
  const firstRollback = CI.action<void>("rollback first", () => () => Effect.void, { timeout: 1000 })
  const first = CI.action<void>("first", () => () => Effect.void, { timeout: 1000, rollback: firstRollback })
  const secondRollback = CI.action<void>("rollback second", () => () => Effect.void, { timeout: 1000 })
  const second = CI.action<void>("second", function* () {
    yield* first()
    return () => Effect.void
  }, { timeout: 1000, rollback: secondRollback })
  const health = CI.action<void>("health", function* () {
    yield* second()
    return () => Effect.fail(new Error("health regression"))
  }, { retries: { limit: 1, delay: 0 } })
  await assert.rejects(CI.runPromise(CI.workflow("reverse", () => health()), {
    output: "silent", actionExecutor: makeActionExecutor(step, new Set()),
  }), /health regression/)
  assert.deepEqual(attempts.map(({ name }) => name), [
    'action:"first"', 'action:"second"', 'action:"health"', 'action:"health"',
    'action:"rollback second"', 'action:"rollback first"',
  ])
})
