import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({ worker: { name: "effect-ci-source-formatter", entrypoint: "./src/worker.ts",
  compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], workersDev: false, previewUrls: false,
  observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
  env: { LOADER: bindings.workerLoader() },
  exports: { FormatterWorkflow: exports.workflow({ name: "effect-ci-source-formatter-checks" }),
    AssertionWorkflow: exports.workflow({ name: "effect-ci-vitest-subset-checks" }),
    AssertionTail: exports.worker(), AssertionJournal: exports.durableObject({ storage: "sqlite" }) },
} });
