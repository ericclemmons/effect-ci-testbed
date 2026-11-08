import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  accountId: "da2f8f3e41d6b5018df12a58b417d918",
  worker: {
    name: "cf-ci-dynamic-worker-checks",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-09-01",
    workersDev: false,
    previewUrls: false,
    observability: { enabled: true },
    exports: {
      CI: exports.workflow({ name: "cf-ci-dynamic-worker-checks" }),
    },
    env: {
      ARTIFACTS: bindings.artifacts({ namespace: "cf-ci" }),
      // Lets each run report which pipeline commit it executed.
      PIPELINE_SHA: bindings.text(process.env.CF_CI_PIPELINE_SHA ?? "local"),
    },
  },
});
