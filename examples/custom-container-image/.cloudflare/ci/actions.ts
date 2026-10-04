import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const buildImage = CI.action("build container image", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("docker build --tag effect-ci-custom-image:review .")
})

export const publishImage = CI.action("publish container image", () => function* () {
  const workspace = yield* buildImage()

  yield* workspace.exec("docker image inspect effect-ci-custom-image:review")

  return yield* workspace.exec("echo docker push registry.example/effect-ci-custom-image:review")
})
