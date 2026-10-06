import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const deploy = CI.action("deploy", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("echo deploy")
})
