import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", () =>
  Effect.succeed(CI.Workspace.local(app)),
)

export const install = CI.action("install", (workspace: CI.Workspace) =>
  workspace.exec("npm ci"),
)

export const lint = CI.action("lint", (workspace: CI.Workspace) =>
  workspace.exec("npm run lint"),
)

export const test = CI.action("test", (workspace: CI.Workspace) =>
  workspace.exec("npm test"),
)

export const build = CI.action("build", (workspace: CI.Workspace) =>
  workspace.exec("npm run build"),
)
