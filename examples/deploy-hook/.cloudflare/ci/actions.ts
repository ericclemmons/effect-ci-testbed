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

export const build = CI.action("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("npx cf build --mode production")
})

export const deploy = CI.action("deploy", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec(
    "npx cf deploy --prebuilt --mode production --dry-run",
  )
})
