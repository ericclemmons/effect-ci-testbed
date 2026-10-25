import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return function* () {
    const workspace = yield* source.checkout()
    return workspace.directory("app")
  }
})

interface ShardReport {
  readonly index: number
  readonly total: number
  readonly history: Record<string, number>
  readonly results: ReadonlyArray<{ readonly file: string; readonly durationMs: number; readonly passed: boolean }>
}

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"

// Distinct definitions matter: the runtime memoizes by action ID, not arguments.
export const shards = [0, 1].map((index) => CI.action<ShardReport>(
  `test shard ${index}/2`,
  () => function* () {
    const workspace = yield* checkout()
    const tested = yield* workspace.exec(`node scripts/run-shard.mjs ${index} 2`)
    if ((yield* CI.executionMode) === "plan") return { index, total: 2, results: [], history: {} }
    const report = yield* tested.readFile(`reports/shard-${index}.json`)
    if (report === undefined) return yield* Effect.fail(new Error(`Missing shard ${index} report`))
    return JSON.parse(report) as ShardReport
  },
))

export const recordTimings = CI.action("record timings", () => function* () {
  const reports: ShardReport[] = []
  for (const shard of shards) reports.push(yield* shard())
  const workspace = yield* checkout()
  // Carry reports as durable action results, then materialize them in the join's
  // own filesystem. This works with isolated Containers as well as local runs.
  const command = `node scripts/update-history.mjs --reports-json ${shellQuote(JSON.stringify(reports))}`
  return yield* workspace.exec(command)
})
