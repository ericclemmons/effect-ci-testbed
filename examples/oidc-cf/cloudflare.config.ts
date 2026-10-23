import { defineConfig } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-oidc-cf",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    previewUrls: false,
  },
});
