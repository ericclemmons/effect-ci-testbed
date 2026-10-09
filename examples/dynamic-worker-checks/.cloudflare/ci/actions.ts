import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as Tools from "@effect-ci-testbed/source-tools"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const format = CI.check("format source", () => function* () {
  const workspace = yield* checkout()
  const path = "app/src/index.ts"
  const source = yield* workspace.readFile(path)

  if (source === undefined) {
    return yield* Effect.fail(new Error(`Missing ${path}`))
  }

  const formatted = yield* Tools.format({ files: { [path]: source }, options: { semi: false } })

  if (formatted.files[path] !== source) {
    return yield* Effect.fail(new Error(`${path} is not formatted`))
  }
})
