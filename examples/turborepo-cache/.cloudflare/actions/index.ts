import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

export const install = CI.action<CI.Workspace>("install", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("npm --prefix examples/turborepo-cache/app ci")
})

export const build = CI.action<CI.Workspace>("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec(
    "cd examples/turborepo-cache/app && npx turbo run build",
  )
})
