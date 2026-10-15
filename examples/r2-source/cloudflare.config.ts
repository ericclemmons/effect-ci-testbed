import { bindings, defineConfig, defineContainer, exports } from "cf/config";

const workspace = defineContainer({
  name: "effect-ci-r2-source-workspace",
  schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "./Dockerfile" } },
});
export default defineConfig({
  worker: {
    name: "effect-ci-r2-source",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: false,
    previewUrls: false,
    observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
    env: { SOURCE_BUCKET: bindings.r2({ name: "effect-ci-r2-source-input" }) },
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      R2SourceWorkflow: exports.workflow({ name: "effect-ci-r2-source-checks" }),
    },
  },
  containers: [workspace],
});
