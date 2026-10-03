import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(app)
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.install()
})

export const verifyContainer = CI.action("verify container", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec('test "$(uname -s)" = Linux')
})

export const test = CI.action("test", () => function* () {
  const workspace = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.run("test")
})
