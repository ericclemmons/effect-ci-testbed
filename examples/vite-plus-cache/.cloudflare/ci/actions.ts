import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec(
    "npm --prefix app install --ignore-scripts --no-audit --no-fund",
  )
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* install()
  const vp = yield* CI.PackageManager.VitePlus(workspace.directory("app"))

  return yield* vp.run("build")
})
