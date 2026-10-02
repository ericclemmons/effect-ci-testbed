import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout("examples/package-manager-cache/app")
})

export const install = CI.action("install", () => function* (
  options: CI.PackageManager.InstallOptions = {},
) {
  const workspace = yield* checkout()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.install(options)
})

export const verify = CI.action("verify", () => function* (
  options: CI.PackageManager.InstallOptions = {},
) {
  const workspace = yield* install(options)
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.run("verify")
})
