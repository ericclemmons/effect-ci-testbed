import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

export const verify = CI.check("verify Artifacts source", () => function* () {
  const workspace = yield* checkout()
  const contents = yield* workspace.readFile("source.txt")
  if (contents?.trim() !== "source from artifacts") {
    return yield* Effect.fail(new Error("Artifacts source was not materialized"))
  }
})
