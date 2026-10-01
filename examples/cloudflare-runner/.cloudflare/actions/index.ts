import * as CI from "@effect-ci-testbed/ci"

export interface BuildArtifacts {
  readonly installation: Installation
  readonly paths: ReadonlyArray<string>
}

export interface Installation {
  readonly checkpoint: CI.WorkspaceCheckpoint
}

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout("examples/cloudflare-runner/app")
})

export const install = CI.action<Installation>("install", () => function* () {
  const workspace = yield* checkout()
  yield* workspace.exec("npm ci")

  return {
    checkpoint: yield* workspace.checkpoint("npm-install"),
  }
})

export const build = CI.action<BuildArtifacts>("build", () => function* () {
  const installation = yield* install()
  const workspace = yield* installation.checkpoint.restore()

  yield* workspace.exec("npm run build")

  return {
    installation,
    paths: ["dist/index.js"],
  }
})
