import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("node app/build.ts")
})

export const verify = CI.action("verify", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec("node --test app/build.test.ts")
})
