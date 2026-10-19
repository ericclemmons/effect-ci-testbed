import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";

export default {
  projectId: "effect-ci-developer-loop",
  tests: "verification/*.e2e.ts",
  timeout: 30_000,
  launchTimeout: 30_000,
  actionTimeout: 5_000,
  assertionTimeout: 5_000,
  retries: 0,
  workers: 1,
  video: "on",
  trace: "on",
  targets: [
    {
      engine: web({ viewport: { width: 960, height: 540 } }),
      app: {
        url: "http://127.0.0.1:18764",
        command: { executable: "node", args: ["verification/preview.mjs"], reuseExisting: false },
      },
    },
  ],
} satisfies E2EConfig;
