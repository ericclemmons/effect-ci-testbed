import { defineConfig, defineContainer, exports } from "cf/config"

const name = "effect-ci-cloudflare-hitl-release"

const workspace = defineContainer({
  name: "effect-ci-hitl-workspace",
  schedulingPolicy: "durable-object",
  images: {
    workspace: {
      dockerfile: "../../packages/cloudflare/Dockerfile",
    },
  },
})

export default defineConfig({
  worker: {
    name,
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-08",
    compatibilityFlags: ["nodejs_compat"],
    exports: {
      WorkspaceContainer: exports.durableObject({
        storage: "sqlite",
        container: workspace,
      }),
      EffectCIWorkflow: exports.workflow({ name }),
    },
  },
  containers: [workspace],
})
