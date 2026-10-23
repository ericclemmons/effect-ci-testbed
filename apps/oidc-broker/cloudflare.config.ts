import { defineConfig, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-oidc-broker",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    previewUrls: false,
    exports: { TokenLease: exports.durableObject({ storage: "sqlite" }) },
  },
});
