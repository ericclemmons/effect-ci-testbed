import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("./app", import.meta.url))

export const checkout = CI.step("checkout", () =>
  Effect.succeed(CI.Workspace.local(app)),
)

export const install = CI.step("install", function* () {
  const workspace = yield* checkout
  return yield* workspace.exec("npm ci")
})

export const lint = CI.step("lint", function* () {
  const workspace = yield* install
  return yield* workspace.exec("npm run lint")
})

export const test = CI.step("test", function* () {
  const workspace = yield* lint
  return yield* workspace.exec("npm test")
})

export const build = CI.step("build", function* () {
  const workspace = yield* test
  return yield* workspace.exec("npm run build")
})

export default CI.workflow("node-npm", build)
