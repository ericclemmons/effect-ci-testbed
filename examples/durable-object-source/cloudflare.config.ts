import { defineConfig, defineContainer, exports } from "cf/config";

const workspace = defineContainer({ name: "effect-ci-durable-source-workspace", schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "./Dockerfile" } } });
export default defineConfig({
  worker: { name: "effect-ci-durable-source", entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], workersDev: false, previewUrls: false,
    observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      SourceRevisions: exports.durableObject({ storage: "sqlite" }),
      SourceIntegrityFixture: exports.durableObject({ storage: "sqlite" }),
      DurableSourceWorkflow: exports.workflow({ name: "effect-ci-durable-source-checks" }),
      SourceBoundaryWorkflow: exports.workflow({ name: "effect-ci-durable-source-boundaries" }),
    },
  }, containers: [workspace],
});
