import * as Schema from "effect/Schema";
import type { HostFinalization } from "@effect-ci-testbed/github-cloudflare";
import { deliverReviewPresentation } from "@effect-ci-testbed/github-cloudflare/notification-delivery";
import { demoSiteUrl } from "@effect-ci-testbed/cloudflare/demo-site";
import type { ReviewedReleaseBroker } from "@effect-ci-testbed/cloudflare/reviewed-release";
import type { HmdApprovals } from "./hmd-approval.ts";
import { finalizeDemoRelease } from "./demo-release.ts";
import { demoReleaseError } from "./demo-release-error.ts";
import { showcaseProductionAllowed, showcaseSelection } from "./showcase-policy.ts";
import { ShowcaseCandidate, ShowcaseDecision, ShowcasePublication, ShowcaseStartCapability, ShowcaseWakeup } from "./showcase-protocol.ts";
import { cleanupShowcase } from "./showcase-cleanup.ts";

const once = { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" } as const;
/** Native host continuation: checked preview first, then an actual consumed
 * human decision BEFORE candidate upload or the first traffic allocation. */
export async function finalizeShowcaseRun(context: HostFinalization<unknown>) {
  await cleanupShowcase(context.step, context.exports, context.instanceId);
  if (showcaseSelection(context.parameters)) return;
  let published: typeof ShowcasePublication.Encoded;
  try {
    published = Schema.encodeSync(ShowcasePublication)(await Schema.decodeUnknownPromise(ShowcasePublication)(context.value));
  } catch { throw Error("Invalid checked showcase publication"); }
  if (published.revision !== context.parameters.revision || published.url !== demoSiteUrl(published))
    throw Error("Checked preview identity mismatch");
  context.card.setResultLink("Open checked preview", published.url);
  if (!showcaseProductionAllowed(context.parameters)) {
    await context.observe?.("showcase-preview", context.card.render());
    return;
  }
  const { step, instanceId: owner, card } = context;
  const reviews = (context.exports as { HmdApprovals: DurableObjectNamespace<HmdApprovals> }).HmdApprovals.getByName(owner);
  const timestamp = () => new Date().toISOString();
  let primaryFailed = false;
  try {
    const capability = await step.do("showcase:start-register", once, async () => {
      try {
        const value = await reviews.registerShowcaseStart(owner, published.digest, Date.now() + 300_000);
        const decoded = await Schema.decodeUnknownPromise(ShowcaseStartCapability)(value);
        const result = Schema.encodeSync(ShowcaseStartCapability)(decoded);
        if (result.owner !== owner || result.snapshot !== published.digest) throw Error("Showcase start identity mismatch");
        return result;
      } catch { throw Error("Showcase start capability unavailable"); }
    });
    card.update({ type: "approval.requested", workflowId: "demo", stepId: "Start rollout", requestId: published.digest,
      approval: { title: "Start the checked-build rollout?", summary: "A human must choose Progress or Reject. No candidate upload or traffic change happens before this decision. A timeout leaves production unchanged." },
      timestamp: timestamp() });
    const frame = card.render({ onlyStep: "Start rollout" });
    await deliverReviewPresentation(() => context.publish("showcase:start-review", {
      text: frame.text,
      blocks: [...frame.blocks, { type: "actions", elements: [
        { type: "button", action_id: "hmd_approve", text: { type: "plain_text", text: "Progress" }, style: "primary", value: JSON.stringify(capability) },
        { type: "button", action_id: "hmd_reject", text: { type: "plain_text", text: "Reject" }, style: "danger", value: JSON.stringify(capability) },
      ] }],
    }, "Start rollout"));
    const event = await step.waitForEvent("showcase:start-wait", { type: "hmd-review-0", timeout: "5 minutes" });
    const decodedWakeup = await Schema.decodeUnknownPromise(ShowcaseWakeup)(event.payload).catch(() => {
      throw Error("Invalid showcase review wakeup");
    });
    const wakeup = Schema.encodeSync(ShowcaseWakeup)(decodedWakeup);
    if (wakeup.snapshot !== published.digest) throw Error("Stale showcase start event");
    // Events are wakeups only. The private consumed ledger is the authority.
    const decision = await step.do("showcase:start-decision", once, async () => {
      try {
        const value = await reviews.readShowcaseDecision(owner, 0, published.digest);
        return Schema.encodeSync(ShowcaseDecision)(await Schema.decodeUnknownPromise(ShowcaseDecision)(value));
      } catch { throw Error("No consumed human showcase decision"); }
    });
    if (decision.snapshot !== published.digest) throw Error("Showcase human decision identity mismatch");
    card.update({ type: "approval.resolved", workflowId: "demo", stepId: "Start rollout", requestId: published.digest,
      decision: decision.decision, actor: decision.actor, timestamp: timestamp() });
    // Replace the capability-bearing reply itself, not only the parent/table.
    await context.observe?.("showcase:start-resolved", card.render({ onlyStep: "Start rollout" }), "Start rollout");
    if (decision.decision !== "approved") throw Error("Showcase rollout rejected; production is unchanged");
  } catch (error) {
    primaryFailed = true;
    card.update({ type: "workflow.completed", workflowId: "demo", conclusion: "failure", timestamp: timestamp() });
    card.setFailure("Start rollout", "Rollout did not start. This review is closed.");
    try { await context.observe?.("showcase:start-closed", card.render({ onlyStep: "Start rollout" }), "Start rollout"); }
    catch { /* preserve the recorded release failure */ }
    throw error;
  } finally {
    try { await step.do("showcase:start-close", once, () => reviews.close(owner)); }
    catch { if (!primaryFailed) throw Error("Showcase start cleanup failed; no rollout started"); }
  }
  const broker = (context.environment as unknown as { RELEASE_MANAGER: ReviewedReleaseBroker }).RELEASE_MANAGER;
  const candidate = await step.do("showcase:prepare-candidate", { ...once, timeout: "2 minutes" }, async () => {
    try {
      const raw = await broker.prepareCandidate(published.revision, published.digest);
      const result = Schema.encodeSync(ShowcaseCandidate)(await Schema.decodeUnknownPromise(ShowcaseCandidate)(raw));
      if (result.revision !== published.revision || result.digest !== published.digest) throw Error("Prepared release identity mismatch");
      return result;
    } catch (error) { throw demoReleaseError(error); }
  });
  await finalizeDemoRelease({ ...context, value: candidate }, { destination: "showcase" });
}
