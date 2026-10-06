import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as prettier from "prettier/standalone"
import estree from "prettier/plugins/estree"
import typescript from "prettier/plugins/typescript"

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

  const formatted = yield* Effect.tryPromise(() => prettier.format(source, {
    parser: "typescript",
    plugins: [estree, typescript],
    semi: false,
  }))

  if (formatted !== source) {
    return yield* Effect.fail(new Error(`${path} is not formatted`))
  }
})
