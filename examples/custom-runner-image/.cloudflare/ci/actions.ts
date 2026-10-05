import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const verifyPython = CI.check("verify baked-in python", () => function* () {
  const workspace = yield* checkout()

  yield* workspace.exec("python3 --version")
})
