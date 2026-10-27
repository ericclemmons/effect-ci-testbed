# Independent human rollout review

**Status, October 26, 2026:** implementation and signed execution evidence exist;
the independent human walkthrough for [#141](https://github.com/ericclemmons/effect-ci-testbed/issues/141)
is not established by the inspected records. Keep the issue open. No rollout,
decision, permission change or restoration was performed for this reconciliation.

The issue defines the process: Codex prepares and records; Eric operates the
actual Slack controls only when explicitly ready. This handoff uses fetched main
`20f29103911800606929de4f9afa095667606e48`. It changes documentation only, not
the deployed host or its approval policy.

## Credit the existing evidence

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| [Signed Slack handler](./src/hmd-slack.ts) and [private approval ledger](./src/hmd-approval.ts) | HMAC freshness; app/team/channel/reviewer checks; owner, phase, snapshot, token and expiry binding; consumption before delivery; no blind resend | Who physically clicked a control in an earlier run |
| [Showcase continuation](./src/showcase-release.ts) and [phase continuation](./src/demo-release.ts) | Wakeup events are not authority: the continuation reads the consumed private decision before candidate preparation or phase acceptance | Independent human participation inferred from a `slack:` actor string |
| [October 16 main release](../../test/fixtures/demo/test/main-release-20261016.md) | Real build, four signed delegated decisions at 10/25/75/100, uncertain health retained, terminal commit | Independent human review, or restoration after success |
| [Merged signed-route tests, PR #389](https://github.com/ericclemmons/effect-ci-testbed/pull/389) | Actual local Workerd, SQLite and HMAC composition; rejection, timeout, stale/replayed capabilities and rollback with fake external transports | Real Slack clicks or live deployment acceptance |
| [October 24 flywheel](../../examples/release-flywheel/proof/README.md) and [restoration readback](../../examples/release-flywheel/proof/restoration.json) | Real hosted progression and exact historical cleanup; approval explicitly records `agent-on-user-delegation` | Four independent human Slack decisions, native WOBS completeness, or today's allocation |
| [Retained timeout assertions](./src/live-hmd-timeout.test.ts) and [routing diagnostic history](./DEMO-RELEASE.md#bounded-routing-diagnostic-private-operator-only) | Timeout/diagnostic restoration evidence remains available | Human Reject, or permission to reset to those historical versions |

Default Progress/Reject uses no modal. `HMD_REQUIRE_RATIONALE=true` opts into
rationale. Existing [callback tests](./src/hmd-slack.test.ts) cover both modes.
Neither a test actor nor an administrative event may be relabeled as a human.

## Read-only preflight before asking for a live run

Codex owns these checks; they are not work to hand to the reviewer.

- Read the current deployed host version, callback configuration and allowlisted
  reviewer without exposing signing secrets, bearer tokens or capability tokens.
- Read retained native decisions and rejection/restoration histories first. Close
  the issue without comment only if genuine human evidence already satisfies all
  criteria. Do not restart a completed instance to fill a documentation gap.
- Read the current target allocation, broker owner, lease and pending intents.
  Reconcile ambiguous operations before considering another run; do not interrupt
  another owner or assume that a repository pin is the deployed baseline.
- Open the actual current card and its thread in the in-app browser, verify its
  owner, checked revision, phase, snapshot and expiry, and confirm Eric is ready
  before any timed dispatch. An old permalink is not a current approval window.
- Keep the root to live status/CTA and put stage evidence in the maintained thread.
  Verify that consumed/expired controls are retired, not just hidden on the root.

**This session's live-read boundary:** the local `cf` CLI had no authentication
token. A GET for the retained native run through the available Cloudflare
connection returned 401 and reported that the source-pinned target account was
not among its authorized accounts. No additional account access was requested.
The [retained October 15 Slack card](https://ryanflorencefanclub.slack.com/archives/C0C81FU4B5J/p1792078658255589)
opened at Slack sign-in, not at a verified current card. Browser visibility
readback was false; the direct in-app opening fallback returned `queued`, not
`opened`. Live card/callback, private consumed records and current allocation
therefore remain unverified. Use an existing authorized session; do not broaden
permissions or publish credentials to unblock this readback.

## Remaining human interaction

This is an unstarted session plan, not dispatch approval. Agree the exact owned
target, candidate, bounded run count and time window after preflight. Reuse
existing infrastructure; no new resources, inference, permissions or unrelated
campaigns are part of #141. Issues #138/#139/#140 remain separate.

| Case | Eric's interaction | Codex's evidence and cleanup |
| --- | --- | --- |
| Progress | Click the actual current 10/25/75/100 controls before each displayed deadline; a showcase run also has a pre-upload Start control | Capture each snapshot, phase, expiry, actor, accepted time, consumed-decision checkpoint and screenshot; keep uncertainty and risk-acceptance labels |
| Reject | Reject a separate, explicitly scoped current review after traffic has changed | Preserve the original failure, terminal control retirement, native rollback receipt and independent exact-allocation readback; a pre-upload Reject alone does not prove restoration |
| Stale/replay | Exercise a retained old control only within the agreed case, if Slack still exposes it | Verify refusal and no second decision, delivery or allocation write; retired controls plus local negative tests must not be described as a live replay click |
| Emergency acceptance | Only accept explicitly identified risk in the administrative lab, if separately authorized and safe to run | Retain the regression/uncertainty verdict and risk-acceptance basis; never call it healthy or grant the strict controller an override |

The [administrative runner](../../test/apps/example-runner/src/hmd-review-runner.ts)
requires historical baseline `09593237-23b2-4873-bd04-88c8e8488840` at 100%.
It restores the captured allocation after the campaign; the
[strict reviewed-release controller](../../packages/cloudflare/src/reviewed-release.ts)
instead commits a successful candidate and rejects conclusive regression.
Do not reset today's target to make the lab runnable. If the lab pin no longer
matches, stop that case and agree a separately reviewed safe adaptation; do not
substitute a strict production Progress for emergency-override evidence.

For each approved case, retain the original run ID, source and deployed host
revisions, candidate, full captured prior allocation, current card permalink,
native step outputs, screenshots, decision timing and final allocation. Keep
capability tokens and private images out of public commits. Compare every prior
version/percentage with independent cleanup readback and record its deployment
ID. A lost commit acknowledgement needs reconciliation, not a blind rollback.

Do not repair missing evidence by overwriting earlier receipts, deleting
histories, impersonating Eric or changing a timeout/delegated outcome. Close
#141 only after all its criteria have evidence; otherwise retain the exact gap.
