import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})
const verify = CI.check("verify GitLab source", function* () {
  const source = yield* CI.Source
  return function* () {
    const workspace = yield* checkout()
    if (source.reference?.kind === "git") {
      const revision = source.reference.revision
      if (!/^[a-f0-9]{40}$/.test(revision)) return yield* Effect.fail(new Error("Immutable Git revision required"))
      yield* workspace.exec(`test "$(git rev-parse HEAD)" = ${revision}`)
    }
    if ((yield* workspace.readFile("VERSION"))?.trim() !== "6.7.0.pre") {
      return yield* Effect.fail(new Error("Pinned GitLab fixture VERSION mismatch"))
    }
  }
})
export default CI.workflow("gitlab-source", () => verify())
