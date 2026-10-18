import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { smallChange, type SmallChangeDecision, type SmallChangeEvidence, type SmallChangePolicy } from "../../packages/github/src/small-change.ts"

// Trusted organization policy, not a file loaded from the PR under review.
// These thresholds and two README paths are deliberately arbitrary demo choices.
export const policy: SmallChangePolicy = {
  maxChangedLines: 100,
  maxServices: 1,
  minMergedPullRequests: 1,
  requiredChecks: ["test", "build"],
  service: path => ["README.md", "docs/README.md"].includes(path) ? "docs" : undefined,
}

export interface Host {
  /** Complete canonical PR diff, verified checks and deterministic README review. */
  read: () => Promise<SmallChangeEvidence>
  /** Journaled exact-head writer; revalidates evidence using the SAME policy. */
  approve: (evidence: SmallChangeEvidence, decision: SmallChangeDecision) => Promise<void>
}

export function approveSmallChanges(host: Host) {
  const inspect = CI.action<SmallChangeEvidence | undefined>("inspect PR", () => function* () {
    if ((yield* CI.executionMode) === "plan") return
    return yield* Effect.tryPromise(() => host.read())
  })
  const isSmallChange = CI.action<SmallChangeDecision | undefined>("is small change", function* () {
    const evidence = yield* inspect()
    return function* () {
      if ((yield* CI.executionMode) === "plan") return
      if (!evidence) return yield* Effect.fail(Error("PR evidence unavailable"))
      return smallChange(evidence, policy)
    }
  })
  const approve = CI.action<void>("approve small change", function* () {
    const evidence = yield* inspect()
    const decision = yield* isSmallChange()
    return function* () {
      if ((yield* CI.executionMode) === "plan") return
      if (!evidence || !decision?.eligible) return
      // A moved head/base or changed checks must not receive the earlier approval.
      const current = yield* Effect.tryPromise(() => host.read())
      if (JSON.stringify(current) !== JSON.stringify(evidence))
        return yield* Effect.fail(Error("PR evidence changed; normal review required"))
      yield* Effect.tryPromise(() => host.approve(evidence, decision))
    }
  }, { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" })

  return CI.workflow("approve-small-changes", function* () {
    const decision = yield* isSmallChange()
    if ((yield* CI.executionMode) === "plan" || decision?.eligible) yield* approve()
    return decision
  })
}
