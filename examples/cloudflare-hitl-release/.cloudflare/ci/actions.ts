import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return function* () {
    const workspace = yield* source.checkout()

    return workspace.directory("app")
  }
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

export const release = CI.action("release", () => function* () {
  const workspace = yield* build()
  const approval = yield* CI.Approval

  yield* approval.request({
    title: "Approve the production release?",
    summary: "Build passed on Cloudflare. Approve to release it.",
  })

  return yield* workspace.exec("echo npx cf deploy --prebuilt --mode production")
})
