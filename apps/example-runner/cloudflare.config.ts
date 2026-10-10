import { bindings, defineConfig, defineContainer, exports } from "cf/config"
import { HMD_SUBREQUEST_LIMIT } from "./src/hmd-budget.ts"

const workspace = defineContainer({
  name: "effect-ci-example-workspace",
  schedulingPolicy: "durable-object",
  images: {
    workspace: { dockerfile: "../../examples/custom-runner-image/Dockerfile" },
    mise: { dockerfile: "./Dockerfile.mise" },
  },
})

const secretWorkspace = defineContainer({
  name: "effect-ci-secret-workspace",
  schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "../../examples/custom-runner-image/Dockerfile" } },
})

export default defineConfig({
  worker: {
    name: "effect-ci-examples",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    // Bounded HMD lab: at most 94,700 HTTP probes plus checkpoint/RPC headroom.
    limits: { subrequests: HMD_SUBREQUEST_LIMIT },
    env: { RELEASE_MANAGER: bindings.worker({ worker: "effect-ci-release-manager" }), LOADER: bindings.workerLoader(), ARTIFACTS: bindings.artifacts({ namespace: "default" }), ANALYTICS_SQL: bindings.analyticsSQL(), SOURCE_BUCKET: bindings.r2({ name: "effect-ci-example-source" }) },
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      SecretWorkspaceContainer: exports.durableObject({ storage: "sqlite", container: secretWorkspace }),
      CredentialVault: exports.durableObject({ storage: "sqlite" }),
      SecretOutboundWorkflow: exports.workflow({ name: "effect-ci-example-secret-outbound" }),
      ArtifactsSourceWorkflow: exports.workflow({ name: "effect-ci-example-artifacts-source" }),
      R2SourceWorkflow: exports.workflow({ name: "effect-ci-example-r2-source" }),
      AnalyticsProbeWorkflow: exports.workflow({ name: "effect-ci-probe-analytics" }),
      WobsCohortProbeWorkflow: exports.workflow({ name: "effect-ci-probe-wobs-cohort" }),
      ReleaseBrokerProbeWorkflow: exports.workflow({ name: "effect-ci-probe-release-broker" }),
      HostedHmdWorkflow: exports.workflow({ name: "effect-ci-probe-hosted-hmd" }),
      NodeNpmWorkflow: exports.workflow({ name: "effect-ci-example-node-npm" }),
      ZeroConfigWorkflow: exports.workflow({ name: "effect-ci-example-zero-config" }),
      ExecutionPolicyWorkflow: exports.workflow({ name: "effect-ci-example-execution-policy" }),
      RetryWorkflow: exports.workflow({ name: "effect-ci-example-retry" }),
      EffectTimeoutProbeWorkflow: exports.workflow({ name: "effect-ci-probe-effect-timeout" }),
      EffectExhaustionProbeWorkflow: exports.workflow({ name: "effect-ci-probe-effect-exhaustion" }),
      EffectTerminalProbeWorkflow: exports.workflow({ name: "effect-ci-probe-effect-terminal" }),
      RollbackCompensationWorkflow: exports.workflow({ name: "effect-ci-example-rollback" }),
      RollbackExhaustionWorkflow: exports.workflow({ name: "effect-ci-probe-rollback-exhaustion" }),
      ReverseRollbackWorkflow: exports.workflow({ name: "effect-ci-probe-reverse-rollback" }),
      CheckpointRecoveryWorkflow: exports.workflow({ name: "effect-ci-probe-checkpoint-recovery" }),
      PortableArtifactsWorkflow: exports.workflow({ name: "effect-ci-example-portable-artifacts" }),
      ArtifactPolicyProbeWorkflow: exports.workflow({ name: "effect-ci-probe-artifact-policy" }),
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
      CachePolicyWorkflow: exports.workflow({ name: "effect-ci-example-cache-policy" }),
      DynamicFormatterWorkflow: exports.workflow({ name: "effect-ci-example-dynamic-formatter" }),
    },
  },
  containers: [workspace, secretWorkspace],
})
