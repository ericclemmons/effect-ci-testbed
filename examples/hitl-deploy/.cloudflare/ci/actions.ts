import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.install()
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.run("build")
})

export const deploy = CI.action("deploy", () => function* () {
  const workspace = yield* build()
  const approval = yield* CI.Approval

  yield* approval.request({
    title: "Approve the production deployment?",
    summary: "Build passed. Approve to run the no-op production deployment.",
  })
  return yield* workspace.exec("echo npx cf deploy")
})
