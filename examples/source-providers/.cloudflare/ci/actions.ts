import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const verify = CI.check("verify materialized source", () => function* () {
  const workspace = yield* checkout()
  const contents = yield* workspace.readFile("source.txt")

  if (contents?.trim() !== "portable source") {
    return yield* Effect.fail(new Error("source.txt was not materialized"))
  }
})
