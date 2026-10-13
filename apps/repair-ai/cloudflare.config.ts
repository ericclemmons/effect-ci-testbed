import { bindings, defineConfig, exports } from "cf/config"

export default defineConfig({
  worker: {
    name: "effect-ci-repair-ai",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: false,
    previewUrls: false,
    env: { AI: bindings.ai() },
    exports: { InferenceBudgetObject: exports.durableObject({ storage: "sqlite" }) },
  },
})
