import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"
import { build, checkout, install, lint, test } from "../actions/index.ts"

const checks = Effect.gen(function* () {
  const repository = yield* checkout()
  const dependencies = yield* install(repository)
  return yield* Effect.all([
    build(dependencies),
    lint(dependencies),
    test(dependencies),
  ], { concurrency: "unbounded" })
})

export default CI.workflow("node-pnpm", checks, {
  on: ["pull_request", "push"],
})
