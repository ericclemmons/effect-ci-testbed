import * as CI from "@effect-ci-testbed/ci"

export interface BuildArtifacts {
  readonly installation: Installation
  readonly paths: ReadonlyArray<string>
}

export interface Installation {
  readonly workspace: CI.Workspace
}

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout("examples/cloudflare-runner/app")
})

export const install = CI.action<Installation>("install", () => function* () {
  const workspace = yield* checkout()

  return {
    workspace: yield* workspace.exec("npm ci"),
  }
})

export const build = CI.action<BuildArtifacts>("build", () => function* () {
  const installation = yield* install()

  yield* installation.workspace.exec("npm run build")

  return {
    installation,
    paths: ["dist/index.js"],
  }
})
