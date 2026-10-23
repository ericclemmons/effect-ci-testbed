import { defineConfig, defineContainer, exports } from "cf/config";

// OIDC authentication is useful before moving execution off GitHub-hosted runners.
const oidcOnly = process.env.EFFECT_CI_OIDC_ONLY === "true";
const name = process.env.EFFECT_CI_GITHUB_RUNNER_NAME ?? "effect-ci-github-actions-runner";
if (!/^[a-z][a-z0-9-]{0,48}[a-z0-9]$/.test(name)) throw Error("Invalid GitHub runner Worker name");
const runners = oidcOnly ? undefined : defineContainer({
  name,
  schedulingPolicy: "durable-object",
  images: { runner: { dockerfile: "./Dockerfile" } },
});

export default defineConfig({
  worker: {
    name,
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-10-07",
    workersDev: true,
    previewUrls: false,
    // Do not emit request bodies, JIT configurations or App credentials to logs.
    observability: { enabled: false },
    exports: {
      TokenLease: exports.durableObject({ storage: "sqlite" }),
      ...(oidcOnly ? {} : {
        RunnerPool: exports.durableObject({ storage: "sqlite" }),
        ActionsRunner: exports.durableObject({ storage: "sqlite", container: runners! }),
      }),
    },
  },
  containers: runners ? [runners] : [],
});
