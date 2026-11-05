import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const runImage = CI.action("build and run user image", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("node .cloudflare/ci/build-and-run.mjs")
}, { timeout: "5 minutes", retries: { limit: 0, delay: "1 second" } })
