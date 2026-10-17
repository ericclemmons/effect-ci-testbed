import { runnerReceiptDigest } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { syntaxImage, syntaxPolicyDigest, syntaxInspectCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { testPolicyDigest, testInspectCommand } from "@effect-ci-testbed/cloudflare/demo-test-check";

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
