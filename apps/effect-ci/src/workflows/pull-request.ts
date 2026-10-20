import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { smallChange, type SmallChangeDecision, type SmallChangeEvidence } from "../../../../packages/github/src/small-change.ts";
import type { SmallChangeOperation } from "../../../../packages/github/src/small-change-host.ts";

// Org policy belongs to this trusted workflow revision, not PR-supplied code.
// Change these rules here; the runner only supplies scoped read/write capabilities.
// A new policy identity keeps the old threshold-policy journal separate.
export const policyId = "demo-readme-only-v2";
export const smallChangePolicy = ({ files }: SmallChangeEvidence) =>
  files.length === 1 && files[0]?.path === "README.md";

export interface PullRequestCapabilities {
  readonly read: () => Promise<SmallChangeEvidence>;
  /** Host rereads canonical evidence, journals the write and pins commit_id.
   * An ineligible verdict publishes normal-review status, never APPROVE. */
  readonly publish: (evidence: SmallChangeEvidence, decision: SmallChangeDecision) => Promise<SmallChangeOperation>;
}

const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;

/** Ordinary actions, not a special approval interpreter. Planning does no I/O. */
export function pullRequestPolicy(capabilities: PullRequestCapabilities) {
  const inspect = CI.action<SmallChangeEvidence | undefined>("inspect PR", () => function* () {
    if ((yield* CI.executionMode) === "plan") return;
    return yield* Effect.tryPromise({ try: capabilities.read, catch: error => error });
  }, once);
  const review = CI.action<SmallChangeDecision | undefined>("review", function* () {
    const evidence = yield* inspect();
    return function* () {
      if ((yield* CI.executionMode) === "plan") return;
      if (!evidence) throw Error("PR evidence unavailable");
      return smallChange(evidence, smallChangePolicy);
    };
  }, once);
  const approve = CI.action<SmallChangeOperation | undefined>("approve PR", function* () {
    const evidence = yield* inspect();
    const decision = yield* review();
    return function* () {
      if ((yield* CI.executionMode) === "plan") return;
      if (!evidence || !decision) throw Error("PR decision unavailable");
      return yield* Effect.tryPromise({ try: () => capabilities.publish(evidence, decision), catch: error => error });
    };
  }, { ...once, timeout: "10 minutes" });

  return { review, approve, workflow: CI.workflow("org-pull-request", () => approve()) };
}

// The authored workflow is inspectable through the normal CLI. Actual execution
// requires host-injected capabilities, never a developer token in this module.
const unavailable = async (): Promise<never> => { throw Error("Org PR policy requires its trusted host capabilities"); };
const authored = pullRequestPolicy({ read: unavailable, publish: unavailable });
export const { review, approve } = authored;
export default authored.workflow;
