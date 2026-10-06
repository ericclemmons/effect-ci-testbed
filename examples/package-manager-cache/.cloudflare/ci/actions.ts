import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return function* () {
    const workspace = yield* source.checkout()

    return workspace.directory("app")
  }
})

export const install = CI.action("install", () => function* (
  options: CI.JavaScriptInstallOptions = {},
) {
  const workspace = yield* checkout()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.install(options)
})

export const verify = CI.action("verify", () => function* (
  options: CI.JavaScriptInstallOptions = {},
) {
  const workspace = yield* install(options)
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.run("verify")
})
