import { defineConfig, defineContainer, exports, bindings } from "cf/config"
const name = process.env.EFFECT_CI_SNAPSHOT_SITE_NAME ?? "effect-ci-snapshot-site"
const sourceRoot = process.env.EFFECT_CI_SNAPSHOT_SITE_ROOT ?? "examples/conditional-deploy/outputs"
if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw Error("Choose a lowercase snapshot-site Worker name")
if (sourceRoot.startsWith("/") || sourceRoot.split("/").some(part => part === ".." || part === ".") || /[\\\x00-\x1f]/.test(sourceRoot))
  throw Error("Source root must be repository-relative (empty for the repository root)")
const workspace = defineContainer({ name: `${name}-workspace`, schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "../../Dockerfile.standalone" } } })
export default defineConfig({ worker: {
  name, entrypoint: "./worker.ts", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
  workersDev: true, previewUrls: false, env: { SOURCE_ROOT: bindings.text(sourceRoot) },
  exports: {
    WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
    Site: exports.durableObject({ storage: "sqlite" }),
    SnapshotDeploymentBaselines: exports.durableObject({ storage: "sqlite" }),
    SiteWorkflow: exports.workflow({ name: `${name}-deploy` }),
  },
}, containers: [workspace] })
