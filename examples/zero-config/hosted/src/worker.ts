import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import { readSourceManifest } from "./source-manifest.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export const ZeroConfigWorkflow = Cloudflare.workflowEntrypoint(async (parameters, step) => {
  const manifest = await step.do("source:package-json", () =>
    readSourceManifest(parameters, "examples/zero-config"))
  return CI.fromPackageJson(manifest).workflow
}, {
  root: "examples/zero-config",
  container: { image: "workspace" },
  reuseWorkspace: false,
})

export default { fetch: () => new Response("Not found", { status: 404 }) }
