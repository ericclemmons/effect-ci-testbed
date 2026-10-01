import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout("examples/cloudflare-toolchain/app")
})

export const preparePython = CI.action<CI.Workspace>(
  "prepare python toolchain",
  () => function* () {
    const workspace = yield* checkout()

    yield* workspace.exec(
      "DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install --yes --no-install-recommends python3 python3-pip",
    )
    yield* workspace.exec(
      "python3 -m pip install --break-system-packages --root-user-action=ignore --no-cache-dir build==1.3.0 hatchling==1.27.0",
    )

    return workspace
  },
)

export const build = CI.action<void>("build python package", () => function* () {
  const workspace = yield* preparePython()

  yield* workspace.exec("python3 -m build --no-isolation")
})
