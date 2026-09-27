import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", function* () {
  return Effect.fn(function* () {
    return CI.Workspace.local(app)
  })
})

export const install = CI.action("install", function* () {
  return Effect.fn(function* (workspace: CI.Workspace) {
    return yield* workspace.exec("npm ci")
  })
})

export const lint = CI.action("lint", function* () {
  return Effect.fn(function* (workspace: CI.Workspace) {
    return yield* workspace.exec("npm run lint")
  })
})

export const test = CI.action("test", function* () {
  return Effect.fn(function* (workspace: CI.Workspace) {
    return yield* workspace.exec("npm test")
  })
})

export const build = CI.action("build", function* () {
  return Effect.fn(function* (workspace: CI.Workspace) {
    return yield* workspace.exec("npm run build")
  })
})
