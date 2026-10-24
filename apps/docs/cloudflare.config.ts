import { defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "effect-ci-docs",
    compatibilityDate: "2026-10-24",
    workersDev: true,
    assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "404-page" },
  },
})
