import { bindings, defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "effect-ci-d1-migration",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-01",
    env: {
      DATABASE: bindings.d1({ name: "effect-ci-d1-migration" }),
    },
  },
})
