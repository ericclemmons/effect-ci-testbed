import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("verification checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const lint = CI.check("verified lint", () => function* () {
  const workspace = yield* checkout()

  yield* workspace.exec("node --check app/index.js")
}, {
  reuse: { scope: "commit" },
})
