import * as CI from "@effect-ci-testbed/ci"
import { VitePlus } from "@effect-ci-testbed/ci/vite-plus"

const checkout = CI.action("verification checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const lint = CI.check("verified lint", () => function* () {
  const workspace = yield* checkout()

  yield* workspace.exec("node --check app/index.js")
}, {
  reuse: { scope: "commit" },
})

export const inputsLint = CI.check("squash-safe lint", () => function* () {
  const workspace = yield* checkout()
  const vp = yield* VitePlus(workspace)

  yield* vp.run("lint", { cache: true })
}, {
  reuse: true,
})
