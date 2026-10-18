import { defineConfig, defineContainer, exports } from "cf/config";

// Deliberately separate from the owned CI host and production demo.
const name = process.env.NATIVE_RERUN_FIXTURE_NAME ?? "effect-ci-proof-reruns";
if (!/^effect-ci-proof-[a-z0-9-]{1,24}$/.test(name)) throw Error("Choose a dedicated effect-ci-proof-* fixture name");
const workspace = defineContainer({
  name: `${name}-workspace`, schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "../../Dockerfile.standalone" } },
});
export default defineConfig({
  worker: {
    name, entrypoint: "./worker.ts", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    exports: {
      WorkspaceContainer: exports.durableObject({ storage: "sqlite", container: workspace }),
      RerunProof: exports.workflow({ name }),
    },
  },
  containers: [workspace],
});
