import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "walkthrough",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    assets: { notFoundHandling: "single-page-application" },
  },
});
