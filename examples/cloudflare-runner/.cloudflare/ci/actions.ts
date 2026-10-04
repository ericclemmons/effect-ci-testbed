import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return function* () {
    const workspace = yield* source.checkout()

    return workspace.directory("app")
  }
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("npm ci")
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("npm run build")
})
