import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const check = CI.action("check", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("node --check app/index.js")
})
