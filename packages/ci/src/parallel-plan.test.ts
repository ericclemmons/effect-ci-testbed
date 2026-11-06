import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "./index.ts"

test("reading a parallel result does not make it depend on its siblings", async () => {
  const install = CI.action<void>("install", () => function* () {})
  const lint = CI.check("lint", function* () {
    yield* install()
    return function* () {}
  })
  const build = CI.action<string>("build", function* () {
    yield* install()
    return function* () { return "output" }
  })
  const deploy = CI.action<void>("deploy", function* () {
    yield* build()
    return function* () {}
  })
  const workflow = CI.workflow("parallel-read", function* () {
    yield* CI.parallel([lint(), build()])
    assert.equal(yield* build(), "output")
    return yield* deploy()
  })
  const dependencies = async (mode: "plan" | "execute") => Object.fromEntries((await CI.runPromise(workflow, { mode, output: "silent" }))
    .plan.nodes.map(node => [node.id, [...node.dependencies].sort()]))
  for (const mode of ["plan", "execute"] as const) {
    assert.deepEqual(await dependencies(mode), {
      install: [],
      lint: ["install"],
      build: ["install"],
      deploy: ["build", "lint"],
    })
  }
})
