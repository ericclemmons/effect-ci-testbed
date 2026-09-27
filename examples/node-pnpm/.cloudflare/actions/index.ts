import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.acquire(app)
})

export const install = CI.action("install", function* () {
  return (workspace: CI.Workspace) => workspace.exec("pnpm install")
})

export const lint = CI.action("lint", function* () {
  return (workspace: CI.Workspace) => workspace.exec("pnpm run lint")
})

export const test = CI.action("test", function* () {
  return (workspace: CI.Workspace) => workspace.exec("pnpm test")
})

export const build = CI.action("build", function* () {
  return (workspace: CI.Workspace) => workspace.exec("pnpm run build")
})
