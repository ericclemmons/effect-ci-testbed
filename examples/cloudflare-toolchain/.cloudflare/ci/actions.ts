import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return function* () {
    const workspace = yield* source.checkout()

    return workspace.directory("app")
  }
})

export const preparePython = CI.action(
  "prepare python toolchain",
  () => function* () {
    const workspace = yield* checkout()
    const apt = yield* CI.PackageManager.Apt(workspace)
    const prepared = yield* apt.install(["python3", "python3-pip"])

    return yield* prepared.exec(
      "python3 -m pip install --break-system-packages --root-user-action=ignore --no-cache-dir build==1.3.0 hatchling==1.27.0",
    )
  },
)

export const build = CI.action("build python package", () => function* () {
  const workspace = yield* preparePython()

  return yield* workspace.exec("python3 -m build --no-isolation")
})
