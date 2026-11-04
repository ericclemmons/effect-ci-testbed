import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export const checkout = CI.action("workspace checkout", function* () {
  const source = yield* CI.Source
  return function* () {
    return (yield* source.checkout()).directory("app")
  }
})

export const inspect = CI.check("inspect files", () => function* () {
  const workspace = yield* checkout()
  if (!(yield* workspace.exists("input.txt"))) {
    return yield* Effect.fail(new Error("input.txt is required"))
  }
  const contents = yield* workspace.readFile("input.txt")
  if (contents !== "original\n") {
    return yield* Effect.fail(new Error("Unexpected source contents"))
  }
})

export const restore = CI.action("restore checkpoint", () => function* () {
  const workspace = yield* checkout()
  const saved = yield* workspace.checkpoint("before-edit")
  yield* workspace.exec("printf changed > input.txt")
  const restored = yield* saved.restore()
  if ((yield* restored.readFile("input.txt")) !== "original\n") {
    return yield* Effect.fail(new Error("Checkpoint did not restore the original file"))
  }
  return restored
})

export const compare = CI.action<CI.SourceChanges>("source comparison", function* () {
  const source = yield* CI.Source
  return () => source.changes()
})
