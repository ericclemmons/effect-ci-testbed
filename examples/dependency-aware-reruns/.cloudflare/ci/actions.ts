import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("echo install")
})

export const lint = CI.action("lint", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("echo lint")
})

export const format = CI.action("format", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("echo format")
})

export const test = CI.action("test", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("echo test")
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec("echo build")
})
