import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({ worker: { name: "effect-ci-static-assets-broker", entrypoint: "./src/worker.ts",
  compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], workersDev: false, previewUrls: false,
  observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
  env: { SOURCE_READER: bindings.worker({ worker: "effect-ci-github-cloudflare", exportName: "StaticAssetSourceReader" }),
    LOADER: bindings.workerLoader() },
  exports: { StaticAssetRevisions: exports.durableObject({ storage: "sqlite" }),
    StaticAssetsWorkflow: exports.workflow({ name: "effect-ci-static-assets-publish" }) },
} });
