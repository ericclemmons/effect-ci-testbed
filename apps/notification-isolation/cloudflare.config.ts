import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({ worker: {
  name: "effect-ci-provider-isolation", entrypoint: "./src/worker.ts",
  compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
  workersDev: false, previewUrls: false,
  env: { WORKER_METADATA: bindings.versionMetadata() },
  exports: {
    ProviderIsolation: exports.workflow({ name: "effect-ci-provider-isolation" }),
    RejectingDestination: exports.worker(),
    DeliveryJournal: exports.durableObject({ storage: "sqlite" }),
  },
} });
