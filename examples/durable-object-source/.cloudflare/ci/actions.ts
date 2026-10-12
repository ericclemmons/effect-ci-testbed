import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

export const verify = CI.check("verify Durable Object source", () => function* () {
  const workspace = yield* checkout()
  if ((yield* workspace.readFile("source.txt"))?.trim() !== "source from durable object") {
    return yield* Effect.fail(new Error("Durable Object source was not materialized"))
  }
})
