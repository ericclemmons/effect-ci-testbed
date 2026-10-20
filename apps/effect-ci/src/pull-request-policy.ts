import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { pathGlob } from "@effect-ci-testbed/ci/paths";
import { smallChange, type SmallChangeDecision, type SmallChangeEvidence } from "../../../packages/github/src/small-change.ts";
import type { SmallChangeOperation } from "../../../packages/github/src/small-change-host.ts";
import { pullRequestWorkflow } from "./workflows/pull-request.ts";

// Trusted host policy identity, never selected by incoming project code.
export const policyId = "demo-non-code-v3";
const code = pathGlob("**/*.(ts|tsx|json)");
export const smallChangePolicy = ({ files }: SmallChangeEvidence) => !files.some(file => code.test(file.path));

export interface PullRequestCapabilities {
  readonly read: () => Promise<SmallChangeEvidence>;
  /** Canonical reread, exact commit_id, scoped journal and uncertain-ACK reconciliation. */
  readonly publish: (evidence: SmallChangeEvidence, decision: SmallChangeDecision) => Promise<SmallChangeOperation>;
}

/** Bind the small authored workflow to the trusted API reader and writer. */
export function pullRequestPolicy(capabilities: PullRequestCapabilities) {
  let observed: Promise<SmallChangeEvidence> | undefined;
  const read = () => observed ??= capabilities.read();
  const source: CI.SourceService = {
    checkout: () => Effect.die("PR policy uses canonical API evidence, not a checkout"),
    changes: () => Effect.tryPromise(async (): Promise<CI.SourceChanges> => {
      const evidence = await read();
      if (!smallChange(evidence, () => true).eligible) return { status: "unknown", reason: "unavailable" };
      return { status: "known", base: evidence.base, head: evidence.head, paths: evidence.files.map(file => file.path) };
    }),
  };
  const approve = CI.action<SmallChangeOperation | undefined>("approve PR", () => function* () {
    if ((yield* CI.executionMode) === "plan") return;
    const evidence = yield* Effect.tryPromise({ try: read, catch: error => error });
    const decision = smallChange(evidence, smallChangePolicy);
    if (!decision.eligible) return;
    return yield* Effect.tryPromise({ try: () => capabilities.publish(evidence, decision), catch: error => error });
  }, { retries: { limit: 0, delay: "1 second" }, timeout: "10 minutes" });
  return { source, approve, workflow: pullRequestWorkflow(approve) };
}
