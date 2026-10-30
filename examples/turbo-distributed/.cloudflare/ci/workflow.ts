import * as CI from "@effect-ci-testbed/ci"
import { makeSnapshotRunner } from "@effect-ci-testbed/local-container/snapshots"

export const local = ({ root }: { readonly root: string }) => makeSnapshotRunner({ root, paths: ["app"] })

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return function* () {
    return (yield* source.checkout()).directory("app")
  }
})

const install = CI.action("install", function* () {
  const workspace = yield* checkout()
  const manager = yield* CI.PackageManager.JavaScript(workspace)
  return () => manager.install()
})

export default CI.workflow("turbo-distributed", function* () {
  return yield* CI.action("Turbo CI", function* () {
    const workspace = yield* install()
    const turbo = yield* CI.Toolchain.Turbo(workspace)
    return () => turbo.tags("ci")
  })()
})
