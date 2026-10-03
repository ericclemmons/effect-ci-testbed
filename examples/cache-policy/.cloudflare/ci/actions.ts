import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("npm --prefix examples/cache-policy/app ci")
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("npm --prefix examples/cache-policy/app run build")
})

export const verify = CI.action("verify", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec("npm --prefix examples/cache-policy/app run verify")
})
