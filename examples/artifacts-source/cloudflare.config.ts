import { bindings, defineConfig, defineContainer, exports } from "cf/config"

const workspace = defineContainer({
  name: "effect-ci-artifacts-source-workspace",
  schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "./Dockerfile" } },
})

export default defineConfig({
  worker: {
    name: "effect-ci-artifacts-source",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
    env: { ARTIFACTS: bindings.artifacts({ namespace: "default" }) },
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      ArtifactsSourceWorkflow: exports.workflow({ name: "effect-ci-artifacts-source-checks" }),
    },
  },
  containers: [workspace],
})
