import { defineConfig, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-repair-events",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    previewUrls: false,
    exports: {
      NotificationCaptures: exports.durableObject({ storage: "sqlite" }),
      NotificationEvidence: exports.worker(),
    },
  },
});
