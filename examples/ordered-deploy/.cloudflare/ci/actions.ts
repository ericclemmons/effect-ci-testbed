import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const build = CI.action("build applications", () => function* () {
  let workspace = yield* checkout()

  workspace = yield* workspace.exec(
    "cd apps/backend && npx cf build --mode production",
  )

  return yield* workspace.exec(
    "cd apps/frontend && npx cf build --mode production",
  )
})

const deployBackend = CI.action("deploy backend", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec(
    "cd apps/backend && npx cf deploy --prebuilt --mode production --dry-run",
  )
})

const deployFrontend = CI.action("deploy frontend", () => function* () {
  const workspace = yield* deployBackend()

  return yield* workspace.exec(
    "cd apps/frontend && npx cf deploy --prebuilt --mode production --dry-run",
  )
})

export const deploy = CI.action("deploy", () => function* () {
  yield* deployBackend()

  return yield* deployFrontend()
})
