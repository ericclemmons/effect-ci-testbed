import { execFileSync } from "node:child_process"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

export const filesystemSource = (path: string): CI.SourceService => ({
  checkout: () => Effect.succeed(CI.Workspace.local(path)),
  reference: { kind: "local", path },
})

export const gitSource = (options: {
  readonly repository: string
  readonly revision: string
  readonly target: string
}): CI.SourceService => ({
  checkout: () => Effect.sync(() => {
    execFileSync("git", ["clone", "--no-checkout", options.repository, options.target], {
      stdio: "ignore",
    })
    execFileSync("git", ["-C", options.target, "checkout", "--force", options.revision], {
      stdio: "ignore",
    })

    return CI.Workspace.local(options.target)
  }),
  reference: {
    kind: "git",
    repository: options.repository,
    revision: options.revision,
  },
})
