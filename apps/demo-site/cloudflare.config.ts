import { defineConfig, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-demo-site",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    previewUrls: false,
    exports: {
      DemoSitePublisher: exports.worker(),
      DemoSiteRevisions: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
