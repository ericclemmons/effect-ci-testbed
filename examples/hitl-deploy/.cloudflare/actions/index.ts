import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export interface BuildArtifacts {
  readonly installation: Installation
  readonly paths: ReadonlyArray<string>
}

export interface Deployment {
  readonly artifacts: BuildArtifacts
  readonly target: "production"
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
  const approval = yield* CI.Approval

  yield* approval.request({
    title: "Approve the production deployment?",
    summary: "Build passed. Approve to run the no-op production deployment.",
  })
  yield* artifacts.installation.workspace.exec("echo npx cf deploy")

  return {
    artifacts,
    target: "production",
  }
})
