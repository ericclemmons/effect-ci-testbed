import { defineConfig, defineContainer, exports } from "cf/config";

const runners = defineContainer({
  name: "effect-ci-github-actions-runner",
  schedulingPolicy: "durable-object",
  images: { runner: { dockerfile: "./Dockerfile" } },
});

export default defineConfig({
  worker: {
    name: "effect-ci-github-actions-runner",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    previewUrls: false,
    // Do not emit request bodies, JIT configurations or App credentials to logs.
    observability: { enabled: false },
    exports: {
      RunnerPool: exports.durableObject({ storage: "sqlite" }),
      ActionsRunner: exports.durableObject({ storage: "sqlite", container: runners }),
    },
  },
  containers: [runners],
});
