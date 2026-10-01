import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout("examples/github-cloudflare-ci/app")
})

export const install = CI.action<CI.Workspace>("install", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("npm ci")
})

export const build = CI.action<void>("build", () => function* () {
  const workspace = yield* install()

  yield* workspace.exec("npm run build")
})
