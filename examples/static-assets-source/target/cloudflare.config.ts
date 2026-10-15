import { defineConfig } from "cf/config";
// Bootstrap ONLY. Future publication uses the fixed host module + real ASSETS binding.
export default defineConfig({ worker: { name: "effect-ci-static-assets-demo", entrypoint: "./worker.ts",
  compatibilityDate: "2026-10-07", workersDev: true, previewUrls: false } });
