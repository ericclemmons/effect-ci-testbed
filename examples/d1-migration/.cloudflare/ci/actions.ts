import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("npx cf build --mode production")
})

export const migrate = CI.action("migrate database", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec(
    "npx cf d1 migrations apply 11111111-1111-4111-8111-111111111111 --dir migrations --local --persist-to .effect-ci-state --quiet",
  )
})

export const deploy = CI.action("deploy worker", function* () {
  const workspace = yield* migrate()

  return () => workspace.exec("node deploy.mjs")
})
