import { bindings, defineConfig } from "cf/config"

const failureRate = Number(process.env.HMD_DEMO_FAILURE_RATE ?? "0")
if (!Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1) throw new Error("Invalid demo failure rate")

export default defineConfig({
  worker: {
    name: "effect-ci-hmd-demo",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    observability: { enabled: true, headSamplingRate: 1 },
    env: { WORKER_METADATA: bindings.versionMetadata(), FAILURE_RATE: bindings.text(String(failureRate)) },
  },
})
