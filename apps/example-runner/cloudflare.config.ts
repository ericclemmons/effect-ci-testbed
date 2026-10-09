import { defineConfig, defineContainer, exports } from "cf/config"

const workspace = defineContainer({
  name: "effect-ci-example-workspace",
  schedulingPolicy: "durable-object",
})

export default defineConfig({
  worker: {
    name: "effect-ci-examples",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      NodeNpmWorkflow: exports.workflow({ name: "effect-ci-example-node-npm" }),
      NodePnpmWorkflow: exports.workflow({ name: "effect-ci-example-node-pnpm" }),
      OptionalChecksWorkflow: exports.workflow({ name: "effect-ci-example-optional-checks" }),
      WorkspaceWorkflow: exports.workflow({ name: "effect-ci-example-workspace" }),
      ConditionalDeployWorkflow: exports.workflow({ name: "effect-ci-example-conditional-deploy" }),
      PythonToolchainWorkflow: exports.workflow({ name: "effect-ci-example-python-toolchain" }),
      SystemPackageWorkflow: exports.workflow({ name: "effect-ci-example-system-package" }),
      PackageManagerCacheWorkflow: exports.workflow({ name: "effect-ci-example-package-manager-cache" }),
      VitePlusCacheWorkflow: exports.workflow({ name: "effect-ci-example-vite-plus-cache" }),
      TurborepoCacheWorkflow: exports.workflow({ name: "effect-ci-example-turborepo-cache" }),
    },
  },
  containers: [workspace],
})
