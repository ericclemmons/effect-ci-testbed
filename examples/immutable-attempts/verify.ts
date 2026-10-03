import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("install")
})

const lint = CI.action("lint", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("lint")
})

const format = CI.action("format", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("format")
})

const test = CI.action("test", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("test")
})

const build = CI.action("build", () => function* () {
  const workspace = yield* test()

  return yield* workspace.exec("build")
})

const workflow = CI.workflow("immutable-attempts", function* () {
  yield* CI.parallel([lint(), CI.optional(format())])

  return yield* build()
})

const commands: Array<string> = []
const attempts: Array<CI.WorkflowAttempt> = []
let revision = 0
let failTest = true

const options = {
  executor: {
    execute: ({ command, stepId }: CI.CommandExecutionRequest) => Effect.suspend(() => {
      commands.push(`${stepId}:${command}`)

      if (stepId === "test" && failTest) {
        failTest = false
        return Effect.fail(new CI.CommandError(stepId, command, "/workspace", 1))
      }

      return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
    }),
  },
  onAttempt: (attempt: CI.WorkflowAttempt) => {
    attempts.push(attempt)
  },
  output: "silent" as const,
  source: {
    checkout: () => Effect.succeed(CI.Workspace.remote("attempt-workspace", "/workspace")),
  },
  workspacePersistence: {
    commit: ({ stepId, workspace }: Parameters<CI.WorkspacePersistence["commit"]>[0]) =>
      Effect.sync(() => workspace.withRevision({
        provider: "verification",
        value: `${stepId}:${++revision}`,
      })),
    checkpoint: () => Effect.succeed({ provider: "verification", value: undefined }),
    restore: ({ checkpoint }: Parameters<CI.WorkspacePersistence["restore"]>[0]) =>
      Effect.succeed(checkpoint.workspace),
  },
}

await assert.rejects(() => CI.runPromise(workflow, options), CI.CommandError)

const first = attempts[0]!
const firstSnapshot = JSON.stringify(first)

assert.equal(first.number, 1)
assert.equal(first.conclusion, "failure")
assert.deepEqual([...commands].sort(), [
  "format:format",
  "install:install",
  "lint:lint",
  "test:test",
])

commands.length = 0

const second = await CI.runPromise(workflow, {
  ...options,
  rerun: { previous: first, steps: ["test"] },
})

assert.equal(second.attempt.number, 2)
assert.equal(second.attempt.previousAttemptId, first.id)
assert.deepEqual(second.attempt.requested, ["test"])
assert.deepEqual(commands, ["test:test", "build:build"])
assert.deepEqual(
  second.plan.nodes.filter((node) => node.status === "reused").map((node) => node.id),
  ["checkout", "install", "format", "lint"],
)
assert.deepEqual(
  second.plan.nodes.filter((node) => node.status === "complete").map((node) => node.id),
  ["test", "build"],
)
assert.equal(JSON.stringify(first), firstSnapshot)

console.log("immutable attempts and checkpoint reuse passed")
