import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return function* () {
    const workspace = yield* source.checkout()
    return workspace.directory("app")
  }
})

// Distinct definitions matter: the runtime memoizes by action ID, not arguments.
export const shards = [0, 1].map((index) => CI.action<void>(
  `test shard ${index}/2`,
  () => function* () {
    const workspace = yield* checkout()
    yield* workspace.exec(`node scripts/run-shard.mjs ${index} 2`)
  },
))
