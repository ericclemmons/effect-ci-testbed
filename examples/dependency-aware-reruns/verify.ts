import assert from "node:assert/strict"
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
  const workspace = yield* install()

  return yield* workspace.exec("build")
})

const workflow = CI.workflow("dependency-aware-reruns", function* () {
  yield* CI.parallel([
    lint(),
    CI.optional(format()),
  ])
  yield* test()

  return yield* build()
})

const { plan } = await CI.runPromise(workflow, {
  mode: "plan",
  output: "silent",
})

assert.deepEqual(CI.planRerun(plan, ["test"]), {
  requested: ["test"],
  rerun: ["test", "build"],
  reuse: ["checkout", "install", "format", "lint"],
})

assert.deepEqual(CI.planRerun(plan, ["install"]), {
  requested: ["install"],
  rerun: ["install", "format", "lint", "test", "build"],
  reuse: ["checkout"],
})

assert.deepEqual(CI.planRerun(plan, ["format"]), {
  requested: ["format"],
  rerun: ["format"],
  reuse: ["checkout", "install", "lint", "test", "build"],
})

assert.throws(
  () => CI.planRerun(plan, ["missing"]),
  (error) => error instanceof CI.WorkflowPlanError && error.message === "Unknown workflow node: missing",
)

console.log("dependency-aware rerun selection passed")
