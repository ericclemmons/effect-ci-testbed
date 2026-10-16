import type { HostFinalization } from "@effect-ci-testbed/github-cloudflare";
import { demoSiteUrl } from "@effect-ci-testbed/cloudflare/demo-site";
import { demoGitHubAllowed, demoProductionAllowed } from "./demo-policy.ts";
import { demoReviewedReleaseEnabled, finalizeDemoRelease } from "./demo-release.ts";

/** Called only after the checked bytes were acknowledged by the private host publisher. */
export async function finalizeDemoRun(context: HostFinalization<unknown>) {
  if (context.parameters.trigger !== "github" || !demoGitHubAllowed(context.parameters)) return;
  const value = context.value as { revision?: string; digest?: string; url?: string } | undefined;
  if (!value || value.revision !== context.parameters.revision || !/^[a-f0-9]{64}$/.test(value.digest ?? ""))
    throw Error("Published build identity mismatch");
  const url = demoSiteUrl({ revision: context.parameters.revision, digest: value.digest! });
  const production = demoProductionAllowed(context.parameters);
  if (!production && value.url !== url) throw Error("Preview URL mismatch");
  context.card.setResultLink(production ? "Open checked build" : "Open preview", url);
  if (production) {
    if (!demoReviewedReleaseEnabled) throw Error("Production release is not armed");
    await finalizeDemoRelease(context);
    return;
  }
  // A preview has no release candidate, lease, traffic write or approval window.
  const text = `Preview published: <${url}|open checked build>. Production is unchanged.`;
  await context.publish("preview-published", { text, blocks: [
    { type: "section", text: { type: "mrkdwn", text } },
  ] });
}
