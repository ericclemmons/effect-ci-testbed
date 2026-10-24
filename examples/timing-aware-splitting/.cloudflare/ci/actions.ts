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

export const recordTimings = CI.action<void>("record timings", () => function* () {
  for (const shard of shards) yield* shard()
  const workspace = yield* checkout()
  yield* workspace.exec("node scripts/update-history.mjs reports/shard-0.json reports/shard-1.json")
})
