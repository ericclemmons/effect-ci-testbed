import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { OrderedDeploymentHost, deployFrontend } from "./hosted.ts"

export default CI.workflow("ordered-deploy-backend-health-failure", function* () {
  if ((yield* CI.executionMode) === "plan") return yield* deployFrontend()
  const host = yield* OrderedDeploymentHost
  return yield* deployFrontend().pipe(Effect.provideService(OrderedDeploymentHost, {
    targets: host.targets,
    prepare: workspace => host.prepare(workspace),
    publish: request => host.publish(request),
    inspect: (receipt, signal) => host.inspect(receipt, signal),
    record: event => host.record(event),
    fetch: request => request.url === `${host.targets.backend.origin}/health`
      ? Promise.resolve(new Response("Injected prerequisite health failure", { status: 503 }))
      : host.fetch(request),
  }))
})
