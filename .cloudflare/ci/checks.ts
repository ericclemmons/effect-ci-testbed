import * as CI from "@effect-ci-testbed/ci";
import { check, test, build, tutorial } from "./workflow.ts";

// Supporting GitHub recipe/compatibility checks have no deployment capability.
// The native Cloudflare enrollment runs the full root CI/CD graph.
export default CI.workflow("monorepo checks", () => CI.parallel([check(), test(), build(), tutorial()]));
