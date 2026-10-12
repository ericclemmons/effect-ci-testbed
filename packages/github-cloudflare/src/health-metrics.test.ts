import assert from "node:assert/strict"
import test from "node:test"
import { copyHealthMetrics, healthMetricsMarkdown, type HealthMetrics } from "./health-metrics.ts"
import { RunCard } from "./run-card.ts"
import { renderGitHubComment } from "./github-comment.ts"

const metrics = (): HealthMetrics => ({ snapshot: "a".repeat(64), maxErrorRate: .1, maxIncrease: .05,
  previous: { version: "old", from: 1000, to: 2000, completeThrough: 2000, trials: 100, failures: 0,
    sampling: "unsampled", interval: { rate: 0, low: 0, high: .2 } },
  current: { version: "new", from: 3000, to: 4000, completeThrough: 4000, trials: 100, failures: 8,
    sampling: "unsampled", interval: { rate: .08, low: .02, high: .3 } },
})

test("semantic snapshots deep-copy numeric evidence without private images, URLs or capabilities", () => {
  const card = new RunCard({ instanceId: "run", repository: "owner/repo", revision: "abcdef123" })
  const input = metrics()
  Object.assign(input.current, { token: "SECRET", url: "https://private/chart", owner: "SECRET" })
  card.setHealth({ phase: 10, decision: "uncertain", evidenceSource: "experimental-native-wobs", metrics: input }, "F123")
  Object.assign(input.current.interval!, { high: .9 })
  const snapshot = card.snapshot()
  assert.equal(snapshot.health!.metrics!.current.interval!.high, .3)
  assert.ok(Object.isFrozen(snapshot.health!.metrics!.current.interval))
  assert.ok(Object.isFrozen(snapshot.health!.metrics!.current))
  assert.ok(Object.isFrozen(snapshot.health!.metrics))
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|private\/chart|F123/)
  const comment = renderGitHubComment(snapshot)
  assert.match(comment, /Release 10% · uncertain/)
  assert.match(comment, /Previous `old` \| 0\/100 \| 0.00% \| 0.00%–20.00%/)
  assert.match(comment, /Current `new` \| 8\/100 \| 8.00% \| 2.00%–30.00%/)
  assert.match(comment, /allowed increase: 5.00 percentage points/)
  assert.match(comment, /not a forecast or causal comparison/)
  assert.match(comment, /1970-01-01T00:00:03.000Z/)
})

test("incomplete and weighted observations remain explicit unavailable metrics, never zero-rate health", () => {
  for (const patch of [{ completeThrough: 3999 }, { sampling: "weighted" as const }, { trials: 0, failures: 0 }]) {
    const input = metrics()
    const { interval: _interval, ...sample } = input.current
    const body = healthMetricsMarkdown({ ...input, current: { ...sample, ...patch } })
    assert.match(body, /Current `new` \| \d+\/\d+ \| unavailable \| unavailable/)
    assert.match(body, /telemetry still arriving|weighted; not independent trials|no observations/)
    assert.match(body, /Previous `old` \| 0\/100 \| 0.00%/)
  }
})

test("invalid attribution, counts, bounds and unsafe text fail before presentation", () => {
  const original = metrics()
  for (const patch of [
    { version: "@everyone![x](https://evil)" }, { version: "old" }, { from: 1000 },
    { failures: 101 }, { trials: NaN }, { sampling: "weighted" }, { completeThrough: 3999 },
    { interval: { rate: .1, low: 0, high: .3 } }, { interval: { rate: .08, low: .1, high: .3 } },
    { to: Number.MAX_SAFE_INTEGER },
  ]) assert.throws(() => copyHealthMetrics({ ...original, current: { ...original.current, ...patch } } as HealthMetrics), /Invalid health metrics/)
  assert.throws(() => copyHealthMetrics({ ...original, snapshot: "bad" }), /Invalid/)
  assert.throws(() => copyHealthMetrics({ ...original, maxIncrease: -1 }), /Invalid/)
})
