import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import workflow from "../../.cloudflare/ci/workflow.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export const NodePnpmWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  root: "examples/node-pnpm",
  container: {
    image: "workspace",
    instance: "standard-1",
    readyCommand: "command -v pnpm >/dev/null || npm install --global pnpm@12.8.1 --fetch-retries=1 --fetch-timeout=30000",
  },
})

export default { fetch: () => new Response("Not found", { status: 404 }) }
