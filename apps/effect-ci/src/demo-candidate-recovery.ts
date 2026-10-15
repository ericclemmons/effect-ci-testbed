import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  demoCandidatePolicy,
  type DemoCandidateReceipt,
} from "@effect-ci-testbed/cloudflare/demo-candidate";

// Operator recovery of the ONE retained upload, not a new build or actor-selected target.
export const originalCandidate = Object.freeze({
  revision: "f4860ce5532c3d724db41bed511a787c114971e8",
  digest: "e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23",
  version: "d91c0765-1994-4aad-8aad-f359374c2f45",
  moduleDigest: "b31fdf4ab424fa3a284205bbbee1b735e6b1151c3785628f0064669e1f8aabd7",
});
interface Environment {
  RELEASE_MANAGER: {
    reconcileCandidate(
      revision: string,
      digest: string,
      version: string,
    ): Promise<DemoCandidateReceipt>;
  };
}
export function assertRecoveryPayload(payload: unknown): void {
  if (
    !payload ||
    typeof payload !== "object" ||
    Object.getPrototypeOf(payload) !== Object.prototype ||
    Reflect.ownKeys(payload).length !== 1
  )
    throw Error("Invalid candidate recovery payload");
  const mode = Object.getOwnPropertyDescriptor(payload, "mode");
  if (!mode || !("value" in mode) || mode.value !== "reconcile-original")
    throw Error("Invalid candidate recovery mode");
}
/** Authenticated Workflow API only; existing private service binding, zero upload/deploy capability. */
export class DemoCandidateRecoveryWorkflow extends WorkflowEntrypoint<Environment> {
  override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    assertRecoveryPayload(event.payload);
    return step.do(
      "candidate:reconcile-original",
      { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
      async () => {
        const expected = originalCandidate;
        const r = await this.env.RELEASE_MANAGER.reconcileCandidate(
          expected.revision,
          expected.digest,
          expected.version,
        );
        if (
          r.revision !== expected.revision ||
          r.digest !== expected.digest ||
          r.version !== expected.version ||
          r.moduleDigest !== expected.moduleDigest ||
          r.policy !== demoCandidatePolicy ||
          r.script !== "effect-ci-hmd-demo"
        )
          throw Error("Candidate recovery receipt mismatch");
        // RPC Disposable metadata must never enter a durable checkpoint.
        return {
          revision: r.revision,
          digest: r.digest,
          version: r.version,
          moduleDigest: r.moduleDigest,
          policy: r.policy,
          script: r.script,
          uploadPerformed: false,
          deploymentPerformed: false,
        };
      },
    );
  }
}
