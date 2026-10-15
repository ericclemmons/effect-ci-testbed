import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({ worker: { name: "effect-ci-project-checks", entrypoint: "./src/worker.ts",
  compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], workersDev: false, previewUrls: false,
  observability: { enabled: true, headSamplingRate: 1, redactQueryString: true }, env: { LOADER: bindings.workerLoader() },
  exports: { ProjectWorkflow: exports.workflow({ name: "effect-ci-owned-project-checks" }),
    ProjectBoundaryWorkflow: exports.workflow({ name: "effect-ci-owned-project-boundaries" }) },
} });
