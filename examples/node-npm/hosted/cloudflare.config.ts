import { defineConfig, defineContainer, exports } from "cf/config"

const workspace = defineContainer({
  name: "effect-ci-node-npm-workspace",
  schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "./Dockerfile" } },
})

export default defineConfig({
  worker: {
    name: "effect-ci-node-npm",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: false,
    previewUrls: false,
    observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      NodeNpmWorkflow: exports.workflow({ name: "effect-ci-node-npm-checks" }),
    },
  },
  containers: [workspace],
})
