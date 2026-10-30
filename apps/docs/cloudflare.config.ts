import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "effect-ci-docs",
    entrypoint: "./src/worker.mjs",
    compatibilityDate: "2026-10-24",
    workersDev: true,
    env: { ASSETS: bindings.assets() },
    assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "404-page", runWorkerFirst: ["/api/readiness"] },
  },
})
