import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("checkout for compensation", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

export const deploy = CI.action("deploy with retries", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("echo deploy")
}, {
  retries: { limit: 2, delay: 0 },
})

export const rollback = CI.action("redeploy previous version", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("echo rollback")
})
