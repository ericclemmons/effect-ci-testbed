import {
  bindings,
  defineConfig,
  defineContainer,
  exports,
} from "cf/config"

const name = "effect-ci-github-cloudflare"

const workspace = defineContainer({
  name: "effect-ci-workspace",
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
    env: {
      Workspace: bindings.durableObject({
        worker: name,
        exportName: "WorkspaceContainer",
      }),
      EFFECT_CI: bindings.workflow({
        name,
        worker: name,
        exportName: "EffectCIWorkflow",
      }),
    },
    exports: {
      WorkspaceContainer: exports.durableObject({
        storage: "sqlite",
        container: workspace,
      }),
      EffectCIWorkflow: exports.workflow({
        name,
      }),
    },
  },
  containers: [workspace],
})
