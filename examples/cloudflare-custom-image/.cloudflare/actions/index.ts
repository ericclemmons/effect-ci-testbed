import * as CI from "@effect-ci-testbed/ci"

export interface PythonArtifacts {
  readonly paths: ReadonlyArray<string>
  readonly workspace: CI.Workspace
}

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout("examples/cloudflare-custom-image/app")
})

export const build = CI.action<PythonArtifacts>("build python package", () => function* () {
  const workspace = yield* checkout()

  yield* workspace.exec("python3 -m build --no-isolation")

  return {
    paths: ["dist/*.whl", "dist/*.tar.gz"],
    workspace,
  }
})
