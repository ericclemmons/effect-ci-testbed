import * as CI from "@effect-ci-testbed/ci"
import { directoryDeployment } from "@effect-ci-testbed/ci/directory-deployment"
import { fileURLToPath } from "node:url"

// Host configuration: one local destination and its complete deployable scope.
// A remote host supplies its own provider; the workflow needs no target hashes.
const destination = directoryDeployment({
  directory: fileURLToPath(new URL("../../.effect-ci/deployments/site", import.meta.url)),
  paths: ["dist/**"],
})

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})
const build = CI.action("build", () => function* () {
  const workspace = (yield* checkout()).directory("outputs")
  return yield* workspace.exec("node build.mjs")
})
const deploy = CI.action("deploy", function* () {
  const workspace = yield* build()
  return function* () { yield* destination.publish(workspace); return workspace }
})

export const local: CI.RunConfiguration = { workspaceChanges: destination.changes }

export default CI.workflow("changed-outputs", function* () {
  const workspace = yield* build()
  if (yield* workspace.changed("dist/**")) return yield* deploy()
  return workspace
})
