import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "effect-ci-pr-previews",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    previewUrls: false,
    env: { LOADER: bindings.workerLoader() },
    exports: {
      PreviewRegistry: exports.durableObject({ storage: "sqlite" }),
      PreviewBuildWorkflow: exports.workflow({ name: "effect-ci-pr-preview-build" }),
    },
  },
});
