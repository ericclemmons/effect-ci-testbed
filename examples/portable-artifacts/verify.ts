import assert from "node:assert/strict"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const checkout = CI.action("artifact checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

const build = CI.action<CI.WorkspaceArtifact>("publish build", () => function* () {
  const workspace = yield* checkout()
  const built = yield* workspace.exec("build")

  return yield* CI.Artifact.publish(built, {
    name: "worker",
    paths: ["dist/worker.js"],
  })
})

const deploy = CI.action("restore build", () => function* () {
  const artifact = yield* build()
  const workspace = yield* CI.Artifact.restore(artifact)

  return yield* workspace.exec("deploy")
})

const workflow = CI.workflow("portable-artifacts", () => deploy())
const { plan } = await CI.runPromise(workflow, { mode: "plan", output: "silent" })

assert.deepEqual(
  plan.nodes.find((node) => node.id === "publish build")?.artifacts,
  [{ direction: "publish", name: "worker", paths: ["dist/worker.js"] }],
)
assert.deepEqual(
  plan.nodes.find((node) => node.id === "restore build")?.artifacts,
  [{ direction: "restore", name: "worker", paths: ["dist/worker.js"] }],
)

const commands: Array<string> = []
const executed = await CI.runPromise(workflow, {
  executor: {
    execute: ({ command }) => {
      commands.push(command)
      return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
    },
  },
  output: "silent",
})

assert.deepEqual(commands, ["build", "deploy"])
assert.equal(executed.value.kind, "local")

console.log("portable artifact planning passed")
