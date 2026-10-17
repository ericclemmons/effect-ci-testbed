import { runnerReceiptDigest } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { syntaxImage, syntaxPolicyDigest, syntaxInspectCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { testPolicyDigest, testInspectCommand } from "@effect-ci-testbed/cloudflare/demo-test-check";
import manifest from "../../../examples/demo/package.json" with { type: "json" };
import { syntaxRepository, syntaxWorkflow } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import type { RunnerStepIdentity } from "@effect-ci-testbed/cloudflare/runner-step-result";

export const demoTrustedNodeBase = "node:24.22.0-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315";

export function demoRunnerInspectCommand(suite: boolean) {
  // The pinned root-owned Node binary reports its real uid. Project commands
  // cannot replace that binary in the dedicated unprivileged demo image.
  return (suite ? testInspectCommand : syntaxInspectCommand).replace("const fs=require",
    'if(process.getuid?.()!==1000)throw Error("Untrusted runner uid");const fs=require');
}

/** Separate authority/domain from the retired local-note demo enrollment. */
export async function demoRunnerPolicyDigest(suite: boolean) {
  return runnerReceiptDigest(new TextEncoder().encode(JSON.stringify([
    "demo-trusted-runner-v1", await (suite ? testPolicyDigest : syntaxPolicyDigest)(), syntaxImage,
    "host-owned-key/exact-commit/before-and-after-inputs/successful-command/output-digests",
    "trusted-demo/uid-1000/root-owned-runtime/non-login-shell", demoRunnerInspectCommand(suite),
  ])));
}

export async function demoBuildIdentity(revision: string, hostVersion: string): Promise<RunnerStepIdentity> {
  if (!/^[a-f0-9-]{36}$/.test(hostVersion)) throw Error("Trusted build reuse requires host version metadata");
  const runtimeDigest = await runnerReceiptDigest(new TextEncoder().encode(JSON.stringify([
    demoTrustedNodeBase,
    "trusted-demo/uid-1000/root-owned-runtime/non-login-shell", hostVersion,
  ])));
  const policyDigest = await runnerReceiptDigest(new TextEncoder().encode(JSON.stringify([
    "demo-workspace-result-v1", manifest, "build", "host-inferred-script-and-hooks",
    "exact-commit/no-host-secrets/immutable-final-snapshot/computation-only", runtimeDigest,
  ])));
  return { kind: "step-result", repository: syntaxRepository, revision, workflowId: syntaxWorkflow,
    stepId: "build", policyDigest, runtimeDigest };
}
