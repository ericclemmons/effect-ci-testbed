import * as CI from "@effect-ci-testbed/ci";
import { validate } from "./workflow.ts";

// Supporting GitHub recipe/compatibility checks have no deployment capability.
// The native Cloudflare enrollment runs the full root CI/CD graph.
export default CI.workflow("monorepo checks", () => validate());
