import { defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "effect-ci-ordered-deploy-frontend",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-01",
  },
})
