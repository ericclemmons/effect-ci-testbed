import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.install()
})

export const lint = CI.action("lint", () => function* () {
  const workspace = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.run("lint")
})

export const format = CI.action("format", () => function* () {
  const workspace = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.run("format")
})
