import { bindings, defineConfig, exports } from "cf/config";
export default defineConfig({
  worker: {
    name: "effect-ci-repair-agent",
    entrypoint: "./src/placeholder.ts",
    compatibilityDate: "2026-10-07",
    workersDev: false,
    previewUrls: false,
    env: {
      REPAIR_AI: bindings.worker({ worker: "effect-ci-repair-ai" }),
      OWNED_INCIDENT: bindings.worker({
        worker: "effect-ci-repair-events",
        exportName: "OwnedIncidentAdmission",
      }),
    },
    exports: {
      ProposalProbeWorkflow: exports.workflow({
        name: "effect-ci-flue-proposal-probe",
      }),
      RecordedProposalEvidence: exports.worker(),
      IncidentProposalWorkflow: exports.workflow({
        name: "effect-ci-owned-incident-proposal",
      }),
    },
  },
});
