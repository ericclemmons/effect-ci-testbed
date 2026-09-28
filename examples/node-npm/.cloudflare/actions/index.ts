import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export interface BuildArtifacts {
  readonly installation: Installation
  readonly paths: ReadonlyArray<string>
}

export interface Deployment {
  readonly artifacts: BuildArtifacts
  readonly target: "cloudflare"
}

export interface Installation {
  readonly workspace: CI.Workspace
}

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(app)
})

export const install = CI.action<Installation>("install", () => function* () {
  const workspace = yield* checkout()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return {
    workspace: yield* npm.install({ frozenLockfile: true }),
  }
})

export const lint = CI.action<CI.Workspace>("lint", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  return yield* npm.run("lint")
})

export const format = CI.action<CI.Workspace>("format", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  return yield* npm.run("format")
})

export const test = CI.action<CI.Workspace>("test", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  return yield* npm.run("test")
})

export const build = CI.action<BuildArtifacts>("build", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  yield* npm.run("build")

  return {
    installation,
    paths: ["dist/index.js"],
  }
})

export const deploy = CI.action<Deployment>("deploy", () => function* () {
  const artifacts = yield* build()

  yield* artifacts.installation.workspace.exec("echo npx cf deploy")

  return {
    artifacts,
    target: "cloudflare",
  }
})
