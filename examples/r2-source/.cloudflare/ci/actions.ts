import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

export const verify = CI.check("verify R2 source", () => function* () {
  const workspace = yield* checkout()
  if ((yield* workspace.readFile("source.txt"))?.trim() !== "source from r2") {
    return yield* Effect.fail(new Error("R2 source was not materialized"))
  }
})
