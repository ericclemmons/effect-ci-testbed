import { defineConfig } from "cf/config";
export default defineConfig({
  worker: {
    name: "owned-flue-config-fixture",
    entrypoint: "./src/placeholder.ts",
    compatibilityDate: "2026-10-07",
    workersDev: false,
    previewUrls: false,
  },
});
