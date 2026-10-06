import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const buildImage = CI.action("build user image", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec(
    "docker build --network=host --tag effect-ci-user-image app",
  )
})

export const runImage = CI.action("run user image", () => function* () {
  const workspace = yield* buildImage()

  return yield* workspace.exec(
    "docker run --network=host --rm effect-ci-user-image",
  )
})
