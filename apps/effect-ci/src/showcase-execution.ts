import * as Schema from "effect/Schema";
import type { WorkflowParameters } from "@effect-ci-testbed/github-cloudflare";
import type { ExecutionClaim, ExecutionIdentity, ExecutionReceipt } from "@effect-ci-testbed/cloudflare/execution-receipt";
import { runnerReceiptDigest } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { ShowcaseGoals, ShowcaseRevision, ShowcaseVersion } from "./showcase-protocol.ts";
import { showcaseSelection, showcasePreviewRef, showcaseReleaseRef } from "./showcase-policy.ts";
import { showcaseBuildIdentity, showcaseRepository } from "./showcase-runner-policy.ts";
import type { RetainedShowcaseAttempt } from "./showcase-attempt.ts";

const Context = Schema.Struct({
  revision: ShowcaseRevision,
  trigger: Schema.Literals(["remote", "github"]),
  ref: Schema.optionalKey(Schema.Literals([showcasePreviewRef, showcaseReleaseRef])),
  goals: Schema.optionalKey(ShowcaseGoals),
  rerunFrom: Schema.optionalKey(ShowcaseVersion),
  rerunSteps: Schema.optionalKey(ShowcaseGoals),
});
export type ShowcaseExecutionContext = typeof Context.Encoded;
const Metadata = Schema.Struct({ VERSION_METADATA: Schema.Struct({ id: ShowcaseVersion }) });
const digest = (value: unknown) => runnerReceiptDigest(new TextEncoder().encode(JSON.stringify(value)));
// Provider namespace, not a claim of Cloudflare certification. The operator's
// private key, exact host policy and source identify the actual observation.
const issuer = "https://dash.cloudflare.com";

export function showcaseExecutionContext(parameters: WorkflowParameters): ShowcaseExecutionContext {
  const goals = showcaseSelection(parameters);
  return Schema.encodeSync(Context)(Schema.decodeUnknownSync(Context)({
    revision: parameters.revision, trigger: parameters.trigger,
    ...(parameters.trigger === "github" ? { ref: parameters.ref } : {}), ...(goals ? { goals } : {}),
    ...(parameters.trigger === "remote" && parameters.rerunFrom ? {
      rerunFrom: parameters.rerunFrom, rerunSteps: parameters.targets ?? [parameters.target],
    } : {}),
  }));
}

export function showcaseExecutionVersion(environment: unknown): string {
  try { return Schema.decodeUnknownSync(Metadata)(environment).VERSION_METADATA.id; }
  catch { throw Error("Showcase execution version unavailable"); }
}

export function showcaseExecutionSubject(revision: string) {
  Schema.decodeUnknownSync(ShowcaseRevision)(revision);
  return { issuer, repository: showcaseRepository, revision };
}

/** This observes source/trigger and outcomes. It does not certify a complete
 * prepared-input closure; runner-check receipts have a separate purpose. */
export async function showcaseExecutionIdentity(input: unknown, hostVersion: string): Promise<ExecutionIdentity> {
  try {
    const context = Schema.encodeSync(Context)(Schema.decodeUnknownSync(Context)(input));
    Schema.decodeUnknownSync(ShowcaseVersion)(hostVersion);
    const runtime = await showcaseBuildIdentity(context.revision, hostVersion);
    return { ...showcaseExecutionSubject(context.revision), workflowId: "demo", runtimeDigest: runtime.runtimeDigest,
      policyDigest: await digest(["showcase-execution-observation-v1", hostVersion, "no-cache-review-or-deployment-authority"]),
      inputsDigest: await digest(["checkout-source-identity-not-prepared-input-closure", showcaseRepository, context.revision]),
      eventDigest: await digest(context) };
  } catch { throw Error("Invalid showcase execution context"); }
}

export interface ShowcaseExecutionHistory {
  readonly keyId: string; readonly publicKey: JsonWebKey;
  readonly receipts: ReadonlyArray<ExecutionReceipt>; readonly unverified: number; readonly next?: string;
}
export interface ShowcaseExecutionAuthority {
  recordExecution(context: ShowcaseExecutionContext, claim: ExecutionClaim): Promise<void>;
  executionHistory(revision: string, after?: string): Promise<ShowcaseExecutionHistory>;
  retainCompute(value: RetainedShowcaseAttempt): Promise<void>;
  computeAttempt(revision: string, instanceId: string): Promise<RetainedShowcaseAttempt | undefined>;
}
