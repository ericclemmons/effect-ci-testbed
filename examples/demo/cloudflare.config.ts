import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "effect-ci-tutorial",
    compatibilityDate: "2026-10-07",
    workersDev: true,
  },
});
