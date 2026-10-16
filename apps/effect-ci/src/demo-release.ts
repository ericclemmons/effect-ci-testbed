import type { HostFinalization } from "@effect-ci-testbed/github-cloudflare";
import { deliverReviewPresentation } from "@effect-ci-testbed/github-cloudflare/notification-delivery";
import {
  runReviewedRelease,
  type ReviewedReleaseBroker,
} from "@effect-ci-testbed/cloudflare/reviewed-release";
import type { DemoCandidateReceipt } from "@effect-ci-testbed/cloudflare/demo-candidate";
import type { HmdApprovals } from "./hmd-approval.ts";
import type { HealthChartRenderer } from "./health-renderer.ts";
import type { PrivateSlackImages } from "./private-images.ts";
import { hmdCardObserver } from "./hmd-card.ts";

// Explicit owned-test enrollment. Eric authorized browser-delegated test approvals.
// Not a project environment variable, Workflow payload field or remote CLI flag.
export const demoReviewedReleaseEnabled: boolean = true;
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" } as const;
export async function finalizeDemoRelease(context: HostFinalization<unknown>) {
  const { step, card, instanceId: owner } = context;
  const value = context.value as DemoCandidateReceipt;
  if (!value || value.revision !== context.parameters.revision)
    throw Error("Release source does not match build");
  const broker = (context.environment as unknown as { RELEASE_MANAGER: ReviewedReleaseBroker })
    .RELEASE_MANAGER;
  const host = context.exports as {
    HmdApprovals: DurableObjectNamespace<HmdApprovals>;
    HealthChartRenderer: (options: {}) => Service<HealthChartRenderer>;
    PrivateSlackImages: DurableObjectNamespace<PrivateSlackImages>;
  };
  const reviews = host.HmdApprovals.getByName(owner),
    images = host.PrivateSlackImages.getByName(owner);
  const renderer = host.HealthChartRenderer({});
  const timestamp = () => new Date().toISOString();
  const status = (phase: number, state: "running" | "complete") =>
    card.update({
      type: "step.status",
      workflowId: "cf-ci-demo",
      stepId: `Release ${phase}%`,
      status: state,
      optional: false,
      timestamp: timestamp(),
    });
  try {
    return await runReviewedRelease({
      owner,
      candidate: value,
      broker,
      step,
      settling: async (phase) => {
        status(phase, "running");
        await context.observe?.(`settling-${phase}`, card.render({ onlyStep: `Release ${phase}%` }), `Release ${phase}%`);
      },
      review: async (observation, history) => {
        status(observation.phase, "running");
        const capability = await step.do(
          `demo-review:register-${observation.phase}`,
          once,
          async () => {
            const r = await reviews.registerDemo(
              owner,
              observation.phase,
              observation.snapshot,
              observation.expiresAt,
            );
            return { owner: r.owner, phase: r.phase, snapshot: r.snapshot, token: r.token };
          },
        );
        card.update({
          type: "approval.requested",
          workflowId: "cf-ci-demo",
          stepId: `Release ${observation.phase}%`,
          requestId: observation.snapshot,
          approval: {
            title: `Progress past ${observation.phase}%?`,
            summary: `${observation.decision.reason}. Owned test rollout; browser-delegated approvals are authorized, not independent human review. Progress accepts this snapshot's risk; timeout restores the prior allocation. No automatic acceptance.`,
          },
          timestamp: timestamp(),
        });
        const graph = hmdCardObserver(owner, step, card, {
          includeImage: true,
          render: (points, options) => renderer.render(points, options),
          upload: async (run, snapshot, png) => {
            const r = await images.upload(run, snapshot, png);
            return r.ok ? { ok: true, fileId: r.fileId } : { ok: false };
          },
          publish: async () => {
            const frame = card.render({ onlyStep: `Release ${observation.phase}%` });
            await deliverReviewPresentation(() => context.publish(`review-${observation.phase}`, {
              text: frame.text,
              blocks: [
                ...frame.blocks,
                {
                  type: "actions",
                  elements: [
                    {
                      type: "button",
                      action_id: "hmd_approve",
                      text: { type: "plain_text", text: "Progress" },
                      style: "primary",
                      value: JSON.stringify(capability),
                    },
                    {
                      type: "button",
                      action_id: "hmd_reject",
                      text: { type: "plain_text", text: "Reject" },
                      style: "danger",
                      value: JSON.stringify(capability),
                    },
                  ],
                },
              ],
            }, `Release ${observation.phase}%`));
          },
        });
        await graph({ type: "observed", observations: history });
        // An arbitrary event is only a wake-up. Authority comes from the private consumed review record.
        const event = await step.waitForEvent<{ snapshot?: string }>(
          `demo-review:wait-${observation.phase}`,
          { type: `hmd-review-${observation.phase}`, timeout: "5 minutes" },
        );
        if (event.payload?.snapshot !== observation.snapshot)
          throw Error("Stale demo review event");
        return step.do(`demo-review:decision-${observation.phase}`, once, async () => {
          const r = await reviews.readDemoDecision(owner, observation.phase, observation.snapshot);
          return {
            snapshot: r.snapshot,
            decision: r.decision,
            reason: r.reason,
            actor: r.actor,
            acceptedAt: r.acceptedAt,
          };
        });
      },
      settled: async (observation) => {
        await step.do(`demo-review:close-${observation.phase}`, once, () => reviews.close(owner));
        card.update({
          type: "approval.resolved",
          workflowId: "cf-ci-demo",
          stepId: `Release ${observation.phase}%`,
          requestId: observation.snapshot,
          decision: "approved",
          timestamp: timestamp(),
        });
        status(observation.phase, "complete");
        await context.observe?.(`settled-${observation.phase}`, card.render({ onlyStep: `Release ${observation.phase}%` }), `Release ${observation.phase}%`);
      },
    });
  } finally {
    // Cleanup presentation capabilities only; the controller/broker owns deployment recovery.
    try {
      await step.do("demo-review:close-terminal", once, () => reviews.close(owner));
    } catch {
      /* never replace commit/recovery outcome */
    }
  }
}
