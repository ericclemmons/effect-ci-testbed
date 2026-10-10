import { defineConfig, exports } from "cf/config"

// Dedicated credential boundary. No public workers.dev hostname, custom route or container.
export default defineConfig({
  worker: {
    name: "effect-ci-release-manager",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: false,
    exports: { ReleaseJournalObject: exports.durableObject({ storage: "sqlite" }) },
  },
})
