import * as CI from "@effect-ci-testbed/ci"
export const checkout = CI.action("prepare", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})
export const test = CI.check("worker-tests", () => function* () {
  const workspace = yield* checkout()
  yield* workspace.exec("env -i PATH=/usr/local/bin:/usr/bin:/bin node --test worker.test.mjs")
}, { reuse: { scope: "commit" } })
// Deliberately ordinary work: a signed test result must not skip the build.
export const build = CI.action("build", () => function* () {
  yield* test()
  const workspace = yield* checkout()
  return yield* workspace.exec("cp worker.mjs candidate.mjs")
})
export default CI.workflow("release-flywheel", () => build())
