import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as Context from "effect/ServiceMap"
import { build } from "./actions.ts"
import { deployTarget, type DeploymentHost, type PreparedDeployment, type VerifiedDeployment } from "../../src/target.ts"

export class OrderedDeploymentHost extends Context.Service<OrderedDeploymentHost, DeploymentHost>()(
  "ordered-deploy/Host",
) {}

const prepare = CI.action<{ workspace: CI.Workspace; prepared: PreparedDeployment | undefined }>("pin deployment outputs", function* () {
  const workspace = yield* build()
  return function* () {
    if ((yield* CI.executionMode) === "plan") return { workspace, prepared: undefined }
    const host = yield* OrderedDeploymentHost
    const prepared = yield* Effect.tryPromise(() => host.prepare(workspace))
    return { workspace, prepared }
  }
})

export const deployBackend = CI.action<VerifiedDeployment | undefined>("publish and verify backend", function* () {
  const { workspace, prepared } = yield* prepare()
  return function* () {
    if ((yield* CI.executionMode) === "plan") return undefined
    const host = yield* OrderedDeploymentHost
    return yield* Effect.tryPromise(signal => deployTarget(host, workspace, prepared!, "backend", signal))
  }
}, { retries: { limit: 0, delay: "1 second" }, timeout: "15 minutes" })

export const deployFrontend = CI.action<VerifiedDeployment | undefined>("publish and verify frontend", function* () {
  const backend = yield* deployBackend()
  const { workspace, prepared } = yield* prepare()
  return function* () {
    if ((yield* CI.executionMode) === "plan") return undefined
    const host = yield* OrderedDeploymentHost
    return yield* Effect.tryPromise(signal => deployTarget(host, workspace, prepared!, "frontend", signal, backend))
  }
}, { retries: { limit: 0, delay: "1 second" }, timeout: "15 minutes" })

export default CI.workflow("ordered-deploy-hosted", () => deployFrontend())
