import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout(app)
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()
  return yield* workspace.exec("pnpm install")
})

export const lint = CI.action("lint", () => function* () {
  const workspace = yield* install()
  return yield* workspace.exec("pnpm run lint")
})

export const test = CI.action("test", () => function* () {
  const workspace = yield* install()
  return yield* workspace.exec("pnpm test")
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* install()
  return yield* workspace.exec("pnpm run build")
})
