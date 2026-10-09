import * as CI from "@effect-ci-testbed/ci"

import { build } from "../../../examples/github-cloudflare-ci/.cloudflare/ci/actions.ts"

const release = CI.action("release", () => function* () {
  const workspace = yield* build()
  const approval = yield* CI.Approval

  yield* approval.request({
    title: "Approve the test release?",
    summary: "Cloudflare build passed. Approval runs an echo command only; no production resources will change.",
  })

  return yield* workspace.exec("echo npx cf deploy --prebuilt --mode production")
})

export default CI.workflow("hosted-ci", function* () {
  const event = yield* CI.WorkflowEvent
  const target = (event.payload as { readonly target?: unknown } | undefined)?.target

  if (target === "release") {
    return yield* release()
  }

  if (target !== undefined && target !== "build") {
    throw new Error("Unknown hosted target; choose build or release")
  }

  return yield* build()
})
