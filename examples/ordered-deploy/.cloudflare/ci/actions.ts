import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const build = CI.action("build applications", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("node scripts/build.mjs")
})

export const deployBackend = CI.action("deploy backend", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec("node scripts/deploy.mjs backend")
})

export const deployFrontend = CI.action("deploy frontend", () => function* () {
  const workspace = yield* deployBackend()

  return yield* workspace.exec("node scripts/deploy.mjs frontend")
})
