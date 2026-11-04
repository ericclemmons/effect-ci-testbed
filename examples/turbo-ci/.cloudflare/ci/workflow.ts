import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return function* () {
    return (yield* source.checkout()).directory("app")
  }
})

const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()
  const manager = yield* CI.PackageManager.JavaScript(workspace)
  return yield* manager.install({ frozenLockfile: true })
})

export const check = CI.action("Turbo CI", () => function* () {
  const workspace = yield* install()
  const manager = yield* CI.PackageManager.JavaScript(workspace)
  return yield* manager.run("check")
})

export default CI.workflow("turbo-ci", () => check())
