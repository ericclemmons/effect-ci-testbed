import * as Schema from "effect/Schema";
import { runnerReceiptDigest } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import type { RunnerStepIdentity } from "@effect-ci-testbed/cloudflare/runner-step-result";
import { ShowcaseRevision, ShowcaseVersion } from "./showcase-protocol.ts";
import { demoTrustedNodeBase } from "./demo-runner-policy.ts";
import { showcaseProcessPrefix, showcaseReadyCommand } from "./showcase-process-policy.ts";

export const showcaseRepository = "https://github.com/ericclemmons/effect-ci-testbed";
export const showcaseRoot = "/workspace/repository/examples/demo";

/** Host version pins the authored graph, dependency installer and image policy.
 * Exact-commit reuse is host-to-host only; this never trusts a local cache key.
 */
export async function showcaseBuildIdentity(revision: string, hostVersion: string): Promise<RunnerStepIdentity> {
  Schema.decodeUnknownSync(ShowcaseRevision)(revision);
  Schema.decodeUnknownSync(ShowcaseVersion)(hostVersion);
  const digest = (value: unknown) => runnerReceiptDigest(new TextEncoder().encode(JSON.stringify(value)));
  const runtimeDigest = await digest(["showcase/uid-1000/no-capabilities/no-new-privileges/non-login-shell",
    demoTrustedNodeBase, showcaseProcessPrefix, showcaseReadyCommand, hostVersion]);
  return { kind: "step-result", repository: showcaseRepository, revision, workflowId: "demo", stepId: "build", runtimeDigest,
    policyDigest: await digest(["showcase-checked-workspace-v2", showcaseRoot, "frozen-pnpm-install/lint/test/build", "immutable-native-snapshot/no-publication-or-release", runtimeDigest]) };
}
