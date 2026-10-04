import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("verification checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const lint = CI.action("verified lint", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("echo lint")
}, {
  verification: { scope: "commit" },
})
