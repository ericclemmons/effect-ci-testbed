import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-repair-incident",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: false,
    previewUrls: false,
    env: { WORKER_METADATA: bindings.versionMetadata() },
    observability: {
      enabled: true,
      headSamplingRate: 1,
      issues: { enabled: true },
    },
    exports: {
      OwnedFaultSource: exports.worker(),
      OwnedFaultOnce: exports.durableObject({ storage: "sqlite" }),
      PublicFailureClaim: exports.durableObject({ storage: "sqlite" }),
      PublicIncidentEvidence: exports.worker(),
      OwnedIncidentWorkflow: exports.workflow({
        name: "effect-ci-owned-incident",
      }),
    },
  },
});
