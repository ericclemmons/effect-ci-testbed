import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as CI from "@effect-ci-testbed/ci"
import { readSourceManifest } from "./source-manifest.ts"

import nodeNpm from "../../../examples/node-npm/.cloudflare/ci/workflow.ts"
import nodePnpm from "../../../examples/node-pnpm/.cloudflare/ci/workflow.ts"
import optionalChecks from "../../../examples/optional-checks/.cloudflare/ci/workflow.ts"
import workspace from "../../../examples/cloudflare-runner/.cloudflare/ci/workflow.ts"
import conditionalDeploy from "../../../examples/conditional-deploy/.cloudflare/ci/workflow.ts"
import pythonToolchain from "../../../examples/cloudflare-toolchain/.cloudflare/ci/workflow.ts"
import systemPackage from "../../../examples/system-package/.cloudflare/ci/workflow.ts"
import packageManagerCache from "../../../examples/package-manager-cache/.cloudflare/ci/workflow.ts"
import vitePlusCache from "../../../examples/vite-plus-cache/.cloudflare/ci/workflow.ts"
import turborepoCache from "../../../examples/turborepo-cache/.cloudflare/ci/workflow.ts"
import customRunnerImage from "../../../examples/custom-runner-image/.cloudflare/ci/workflow.ts"
import snapshotFanout from "../../../examples/snapshot-fanout/.cloudflare/ci/workflow.ts"
import nodeVersion from "../../../examples/node-version/.cloudflare/ci/workflow.ts"
import miseToolchain from "../../../examples/mise-toolchain/.cloudflare/ci/workflow.ts"
import exportedActions from "../../../examples/exported-actions/.cloudflare/ci/workflow.ts"
import deployHook from "../../../examples/deploy-hook/.cloudflare/ci/workflow.ts"
import sourceChecks from "../../../examples/dynamic-worker-checks/.cloudflare/ci/workflow.ts"
import cachePolicy from "../../../examples/cache-policy/.cloudflare/ci/workflow.ts"
import { commandRetryProbe, commandFailureProbe, commandSequenceProbe } from "./command-policy-probe.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"
export { DynamicFormatterWorkflow } from "./dynamic-formatter.ts"

export const ZeroConfigWorkflow = Cloudflare.workflowEntrypoint(async (parameters, step) => {
  const manifest = await step.do("source:package-json", () =>
    readSourceManifest(parameters, "examples/zero-config"))
  return CI.fromPackageJson(manifest).workflow
}, {
  root: "examples/zero-config",
  container: { image: "workspace", instance: "standard-1" },
  reuseWorkspace: false,
})

export const CachePolicyWorkflow = Cloudflare.workflowEntrypoint(cachePolicy, {
  root: "examples/cache-policy",
  container: { image: "workspace" },
  reuseWorkspace: false,
  cache: {
    key: "custom-build-cache",
    keyFiles: ["examples/cache-policy/app/src/input.txt"],
    paths: ["examples/cache-policy/app/.cache/build"],
  },
})

// This test host has no HTTP control plane, credentials, or approval endpoint.
// Only authenticated Cloudflare API callers can create or inspect instances.
export default {
  fetch() {
    return new Response("Not found", { status: 404 })
  },
}

export const NodeNpmWorkflow = Cloudflare.workflowEntrypoint(nodeNpm, {
  root: "examples/node-npm",
})
export const NodePnpmWorkflow = Cloudflare.workflowEntrypoint(nodePnpm, {
  root: "examples/node-pnpm",
  container: {
    instance: "standard-1",
    // Runner bootstrap, equivalent to pnpm/action-setup in the YAML comparison.
    readyCommand: "command -v pnpm >/dev/null || npm install --global pnpm@12.8.1 --fetch-retries=1 --fetch-timeout=30000",
  },
})
export const OptionalChecksWorkflow = Cloudflare.workflowEntrypoint(optionalChecks, {
  root: "examples/optional-checks",
  container: { instance: "standard-1" },
})
export const WorkspaceWorkflow = Cloudflare.workflowEntrypoint(workspace, {
  root: "examples/cloudflare-runner",
  reuseWorkspace: false,
})
export const ConditionalDeployWorkflow = Cloudflare.workflowEntrypoint(conditionalDeploy, {
  root: "examples/conditional-deploy",
})

export const PythonToolchainWorkflow = Cloudflare.workflowEntrypoint(pythonToolchain, {
  root: "examples/cloudflare-toolchain",
  container: { instance: "standard-1" },
})

export const SystemPackageWorkflow = Cloudflare.workflowEntrypoint(systemPackage, {
  root: "examples/system-package",
  container: { instance: "standard-1" },
})

export const PackageManagerCacheWorkflow = Cloudflare.workflowEntrypoint(packageManagerCache, {
  root: "examples/package-manager-cache",
  container: { instance: "standard-1" },
  reuseWorkspace: false,
  cache: {
    key: "ericclemmons-effect-ci-testbed-package-manager-cache-npm-v1",
    keyFiles: ["examples/package-manager-cache/app/package-lock.json"],
    paths: ["examples/package-manager-cache/app/.effect-ci/cache/npm"],
  },
})

export const VitePlusCacheWorkflow = Cloudflare.workflowEntrypoint(vitePlusCache, {
  root: "examples/vite-plus-cache",
  container: { instance: "standard-1" },
  reuseWorkspace: false,
  cache: {
    key: "ericclemmons-effect-ci-testbed-vite-plus-task-cache-v1",
    keyFiles: ["examples/vite-plus-cache/app/package-lock.json"],
    paths: [
      "node_modules/.vite/task-cache",
      "examples/vite-plus-cache/app/node_modules/.vite/task-cache",
    ],
  },
})

export const TurborepoCacheWorkflow = Cloudflare.workflowEntrypoint(turborepoCache, {
  root: "examples/turborepo-cache",
  container: { instance: "standard-1" },
  reuseWorkspace: false,
  cache: {
    key: "ericclemmons-effect-ci-testbed-turborepo-task-cache-v1",
    keyFiles: ["examples/turborepo-cache/app/package-lock.json"],
    paths: ["examples/turborepo-cache/app/.turbo/cache"],
  },
})

export const CustomRunnerImageWorkflow = Cloudflare.workflowEntrypoint(customRunnerImage, {
  root: "examples/custom-runner-image",
  container: { image: "workspace", instance: "standard-1" },
  reuseWorkspace: false,
})

export const CommandRetryProbeWorkflow = Cloudflare.workflowEntrypoint(commandRetryProbe, {
  container: { image: "workspace", instance: "standard-1" },
})
export const CommandFailureProbeWorkflow = Cloudflare.workflowEntrypoint(commandFailureProbe, {
  container: { image: "workspace", instance: "standard-1" },
})

export const CommandSequenceProbeWorkflow = Cloudflare.workflowEntrypoint(commandSequenceProbe, {
  container: { image: "workspace", instance: "standard-1" },
})

export const SnapshotFanoutWorkflow = Cloudflare.workflowEntrypoint(snapshotFanout, {
  root: "examples/snapshot-fanout",
  container: { image: "workspace", instance: "standard-1" },
  reuseWorkspace: false,
})

export const NodeVersionWorkflow = Cloudflare.workflowEntrypoint(nodeVersion, {
  root: "examples/node-version",
  container: { image: "mise", instance: "standard-1" },
  reuseWorkspace: false,
})

export const MiseToolchainWorkflow = Cloudflare.workflowEntrypoint(miseToolchain, {
  root: "examples/mise-toolchain",
  container: { image: "mise", instance: "standard-1" },
  reuseWorkspace: false,
})

export const ExportedActionsWorkflow = Cloudflare.workflowEntrypoint(exportedActions, {
  root: "examples/exported-actions",
  reuseWorkspace: false,
})

export const DeployHookWorkflow = Cloudflare.workflowEntrypoint(deployHook, {
  root: "examples/deploy-hook",
  container: { instance: "standard-1" },
  reuseWorkspace: false,
})

export const SourceChecksWorkflow = Cloudflare.workflowEntrypoint(sourceChecks, {
  root: "examples/dynamic-worker-checks",
  reuseWorkspace: false,
})
