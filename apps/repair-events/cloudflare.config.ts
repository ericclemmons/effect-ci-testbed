import { bindings, defineConfig, exports } from "cf/config";
import { publicIncidentEnrollment } from "./src/public-enrollment.ts";
export default defineConfig({
  worker: {
    name: "effect-ci-repair-events",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    previewUrls: false,
    // Bootstrap the private admission export without binding nonexistent future
    // entrypoints. Only the reviewed HOST enrollment enables these fixed edges.
    env: publicIncidentEnrollment === undefined ? {} : {
      PUBLIC_SOURCE: bindings.worker({ worker: "effect-ci-repair-incident", exportName: "PublicIncidentEvidence" }),
      PUBLIC_REPAIR: bindings.worker({ worker: "effect-ci-github-cloudflare", exportName: "PublicIncidentDispatcher" }),
    },
    exports: {
      NotificationCaptures: exports.durableObject({ storage: "sqlite" }),
      PublicIncidentActivations: exports.durableObject({ storage: "sqlite" }),
      PublicIncidentAdmission: exports.worker(),
      NotificationEvidence: exports.worker(),
      OwnedIncidentAdmission: exports.worker(),
      OwnedIncidentAdmissionWorkflow: exports.workflow({
        name: "effect-ci-owned-incident-admission",
      }),
      NotificationInspectionWorkflow: exports.workflow({
        name: "effect-ci-notification-inspection",
      }),
    },
  },
});
