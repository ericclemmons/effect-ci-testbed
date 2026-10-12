import { defineConfig, defineContainer, exports, bindings } from "cf/config"

// cf/config does not yet expose Access resources. See access.config.ts and
// README.md for the accompanying Access application and policy provisioning.

const name = "effect-ci-github-cloudflare"

const workspace = defineContainer({
  name: "effect-ci-workspace",
  schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "./Dockerfile" } },
})

export default defineConfig({
  worker: {
    name,
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    exports: {
      HealthChartRenderer: exports.worker(),
      PrivateSlackImages: exports.durableObject({ storage: "sqlite" }),
      PrivateSlackCards: exports.durableObject({ storage: "sqlite" }),
      HmdApprovals: exports.durableObject({ storage: "sqlite" }),
      HmdReviewWorkflow: exports.workflow({ name: "effect-ci-hmd-review" }),
      WorkspaceContainer: exports.durableObject({
        storage: "sqlite",
        container: workspace,
      }),
      EffectCIWorkflow: exports.workflow({
        name,
      }),
    },
    env: { RELEASE_MANAGER: bindings.worker({ worker: "effect-ci-release-manager" }), ANALYTICS_SQL: bindings.analyticsSQL() },
  },
  containers: [workspace],
})
