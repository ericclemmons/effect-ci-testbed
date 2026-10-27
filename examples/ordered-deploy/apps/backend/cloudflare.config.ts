import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "effect-ci-ordered-deploy-backend",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-01",
    workersDev: true,
    previewUrls: false,
    env: { VERSION_METADATA: bindings.versionMetadata() },
  },
})
