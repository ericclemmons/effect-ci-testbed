import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("artifact checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

export const build = CI.action<CI.WorkspaceArtifact>("publish build", () => function* () {
  const workspace = yield* checkout()
  const built = yield* workspace.exec("mkdir -p dist && echo worker > dist/worker.js")

  return yield* CI.Artifact.publish(built, {
    name: "worker",
    paths: ["dist/worker.js"],
  })
})

export const deploy = CI.action("restore build", () => function* () {
  const artifact = yield* build()
  const workspace = yield* CI.Artifact.restore(artifact)

  return yield* workspace.exec("test -f dist/worker.js")
})
