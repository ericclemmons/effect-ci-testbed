import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export const recipe = (scenario: "retry" | "failure" | "cancel" | "rollback" | "rollback-failure" | "decision-rejected" = "retry") => {
  const prerequisite = CI.action<string>("prerequisite", () => () => Effect.succeed("local input"))
  const restore = CI.action<string>("restore", () => () => scenario === "rollback-failure"
    ? Effect.fail(new Error("Local restoration failed")) : Effect.succeed("local state restored"))
  const work = CI.action<string | void>("work", function* () {
    yield* prerequisite()
    return () => Effect.gen(function* () {
      if ((yield* CI.executionMode) === "plan") return
      const attempt = yield* CI.Attempt
      if (scenario === "decision-rejected") {
        const approval = yield* CI.Approval
        yield* approval.request({ title: "Local policy decision", summary: "Automated rejection, not a human approval" })
      }
      if (scenario === "cancel") return yield* Effect.sleep("1 minute")
      if (scenario === "failure" || scenario === "rollback" || scenario === "rollback-failure" || attempt === 1)
        return yield* Effect.fail(new Error("Local operation failed"))
      return yield* CI.withLifecycle("collecting-evidence", Effect.promise(async () =>
        createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex")))
    })
  }, {
    ...(scenario === "retry" ? { retries: { limit: 1, delay: 20 } } : {}),
    ...(scenario === "rollback" || scenario === "rollback-failure" ? { rollback: restore } : {}),
  })
  return CI.workflow("actionable-lifecycle", function* () { return yield* work() })
}

export default recipe()
