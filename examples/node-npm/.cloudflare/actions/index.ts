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
  readonly packageManager: CI.PackageManager.JavaScriptName
  readonly workspace: CI.Workspace
}

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout(app)
})

export const install = CI.action("install", () => function* () {
  const workspace = yield* checkout()
  const packageManager = yield* CI.PackageManager.JavaScript(workspace)
  return {
    packageManager: packageManager.name,
    workspace: yield* packageManager.install(),
  } satisfies Installation
})

export const lint = CI.action("lint", () => function* () {
  const installation = yield* install()
  const packageManager = yield* CI.PackageManager.JavaScript(installation.workspace)
  return yield* packageManager.run("lint")
})

export const test = CI.action("test", () => function* () {
  const installation = yield* install()
  const packageManager = yield* CI.PackageManager.JavaScript(installation.workspace)
  return yield* packageManager.run("test")
})

export const build = CI.action("build", () => function* () {
  const installation = yield* install()
  const packageManager = yield* CI.PackageManager.JavaScript(installation.workspace)
  yield* packageManager.run("build")
  return {
    installation,
    paths: ["dist/index.js"],
  } satisfies BuildArtifacts
})

export const deploy = CI.action("deploy", () => function* () {
  const artifacts = yield* build()
  yield* artifacts.installation.workspace.exec("echo pnpx cf deploy")
  return {
    artifacts,
    target: "cloudflare",
  } satisfies Deployment
})
