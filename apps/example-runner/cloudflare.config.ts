import { defineConfig, defineContainer, exports } from "cf/config"

const workspace = defineContainer({
  name: "effect-ci-example-workspace",
  schedulingPolicy: "durable-object",
  images: {
    workspace: { dockerfile: "../../examples/custom-runner-image/Dockerfile" },
    mise: { dockerfile: "./Dockerfile.mise" },
  },
})

export default defineConfig({
  worker: {
    name: "effect-ci-examples",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      NodeNpmWorkflow: exports.workflow({ name: "effect-ci-example-node-npm" }),
      NodePnpmWorkflow: exports.workflow({ name: "effect-ci-example-node-pnpm" }),
      OptionalChecksWorkflow: exports.workflow({ name: "effect-ci-example-optional-checks" }),
      WorkspaceWorkflow: exports.workflow({ name: "effect-ci-example-workspace" }),
      ConditionalDeployWorkflow: exports.workflow({ name: "effect-ci-example-conditional-deploy" }),
      PythonToolchainWorkflow: exports.workflow({ name: "effect-ci-example-python-toolchain" }),
      SystemPackageWorkflow: exports.workflow({ name: "effect-ci-example-system-package" }),
      PackageManagerCacheWorkflow: exports.workflow({ name: "effect-ci-example-package-manager-cache" }),
      VitePlusCacheWorkflow: exports.workflow({ name: "effect-ci-example-vite-plus-cache" }),
      TurborepoCacheWorkflow: exports.workflow({ name: "effect-ci-example-turborepo-cache" }),
      CustomRunnerImageWorkflow: exports.workflow({ name: "effect-ci-example-custom-runner-image" }),
      CommandRetryProbeWorkflow: exports.workflow({ name: "effect-ci-probe-command-retry" }),
      CommandFailureProbeWorkflow: exports.workflow({ name: "effect-ci-probe-command-failure" }),
      CommandSequenceProbeWorkflow: exports.workflow({ name: "effect-ci-probe-command-sequence" }),
      SnapshotFanoutWorkflow: exports.workflow({ name: "effect-ci-example-snapshot-fanout" }),
      NodeVersionWorkflow: exports.workflow({ name: "effect-ci-example-node-version" }),
      MiseToolchainWorkflow: exports.workflow({ name: "effect-ci-example-mise-toolchain" }),
      ExportedActionsWorkflow: exports.workflow({ name: "effect-ci-example-exported-actions" }),
      DeployHookWorkflow: exports.workflow({ name: "effect-ci-example-deploy-hook" }),
      SourceChecksWorkflow: exports.workflow({ name: "effect-ci-example-source-checks" }),
    },
  },
  containers: [workspace],
})
