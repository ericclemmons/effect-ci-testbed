import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return function* () {
    const workspace = yield* source.checkout()
    return workspace.directory("app")
  }
})

// A Cartesian product: every locale runs with every currency.
export const checks = ["en-US", "de-DE"].flatMap((locale) =>
  ["USD", "EUR"].map((currency) => CI.action<void>(
    `test ${locale} ${currency}`,
    () => function* () {
      const workspace = yield* checkout()
      yield* workspace.exec(`node verify.mjs ${locale} ${currency}`)
    },
  )),
)
