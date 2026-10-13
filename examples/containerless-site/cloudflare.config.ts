import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-containerless-site",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    previewUrls: false,
    env: { LOADER: bindings.workerLoader() },
    exports: {
      SiteRevisions: exports.durableObject({ storage: "sqlite" }),
      ContainerlessSiteWorkflow: exports.workflow({ name: "effect-ci-containerless-site-build" }),
    },
  },
});
