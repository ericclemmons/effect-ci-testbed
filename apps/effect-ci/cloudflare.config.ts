import { defineConfig, defineContainer, exports, bindings } from "cf/config";

// cf/config does not yet expose Access resources. See access.config.ts and
// README.md for the accompanying Access application and policy provisioning.

const name = "effect-ci-github-cloudflare";

const workspace = defineContainer({
  name: "effect-ci-workspace",
  schedulingPolicy: "durable-object",
  images: { workspace: { dockerfile: "./Dockerfile" } },
});

export default defineConfig({
  worker: {
    name,
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
    exports: {
      DemoCIWorkflow: exports.workflow({ name: "effect-ci-demo" }),
      PublicIncidentRepairOperations: exports.durableObject({ storage: "sqlite" }),
      PublicIncidentDispatcher: exports.worker(),
      PublicPipelineReadiness: exports.worker(),
      PublicIncidentRepairWorkflow: exports.workflow({ name: "effect-ci-public-incident-repair" }),
      DemoCandidateRecoveryWorkflow: exports.workflow({ name: "effect-ci-demo-candidate-recovery" }),
      DemoRoutingDiagnosticWorkflow: exports.workflow({ name: "effect-ci-demo-routing-diagnostic" }),
      GitCheckoutOutbound: exports.worker(),
      HealthChartRenderer: exports.worker(),
      RepairVerifier: exports.worker(),
      RepairWriter: exports.worker(),
      IncidentRepairWriter: exports.worker(),
      OwnedIncidentRepairOperations: exports.durableObject({ storage: "sqlite" }),
      OwnedIncidentRepairWorkflow: exports.workflow({ name: "effect-ci-owned-incident-repair" }),
      OwnedRepairOperations: exports.durableObject({ storage: "sqlite" }),
      OwnedRepairProposalWorkflow: exports.workflow({ name: "effect-ci-owned-repair-proposal" }),
      OwnedRepairVerificationWorkflow: exports.workflow({
        name: "effect-ci-owned-repair-verification",
      }),
      PrivateSlackImages: exports.durableObject({ storage: "sqlite" }),
      PrivateSlackCards: exports.durableObject({ storage: "sqlite" }),
      HmdApprovals: exports.durableObject({ storage: "sqlite" }),
      HmdReviewWorkflow: exports.workflow({ name: "effect-ci-hmd-review" }),
      WorkspaceContainer: exports.durableObject({
        storage: "sqlite",
        container: workspace,
      }),
      EffectCIWorkflow: exports.workflow({
        name,
      }),
    },
    env: {
      PUBLIC_ADMISSION: bindings.worker({ worker: "effect-ci-repair-events", exportName: "PublicIncidentAdmission" }),
      PUBLIC_PROPOSAL: bindings.worker({ worker: "effect-ci-repair-agent", exportName: "PublicProposalDriver" }),
      DEMO_SITE: bindings.worker({
        worker: "effect-ci-demo-site",
        exportName: "DemoSitePublisher",
      }),
      INCIDENT_EVIDENCE: bindings.worker({
        worker: "effect-ci-repair-agent",
        exportName: "IncidentProposalEvidence",
      }),
      REPAIR_EVIDENCE: bindings.worker({
        worker: "effect-ci-repair-agent",
        exportName: "RecordedProposalEvidence",
      }),
      RELEASE_MANAGER: bindings.worker({ worker: "effect-ci-release-manager" }),
      ANALYTICS_SQL: bindings.analyticsSQL(),
    },
  },
  containers: [workspace],
});
