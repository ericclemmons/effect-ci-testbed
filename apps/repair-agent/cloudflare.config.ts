import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-repair-agent",
    entrypoint: "./src/placeholder.ts",
    compatibilityDate: "2026-10-07",
    workersDev: false,
    previewUrls: false,
    env: { REPAIR_AI: bindings.worker({ worker: "effect-ci-repair-ai" }) },
    exports: {
      ProposalProbeWorkflow: exports.workflow({ name: "effect-ci-flue-proposal-probe" }),
      RecordedProposalEvidence: exports.worker(),
    },
  },
});
