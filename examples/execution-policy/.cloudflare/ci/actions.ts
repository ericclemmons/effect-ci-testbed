import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

let attempts = 0

export const resetAttempts = (): void => {
  attempts = 0
}

export const attemptCount = (): number => attempts

export const flaky = CI.action<void>("flaky", () => function* () {
  attempts++

  if (attempts < 3) {
    return yield* Effect.fail(new Error(`transient failure ${attempts}`))
  }
}, {
  retries: { limit: 2, delay: 0, backoff: "constant" },
})

export const slow = CI.action<void>("slow", () => () =>
  Effect.sleep("100 millis").pipe(Effect.asVoid), {
  timeout: 5,
})

const checkout = CI.action("timeout checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(".")
})

export const hangingCommand = CI.action("hanging command", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("sleep 10")
}, {
  timeout: 25,
})
