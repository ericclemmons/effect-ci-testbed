# Independent human rollout review

## Prototype acceptance — November 3, 2026

Eric accepted the smaller user story: receive a clear rollout card, understand
the risk, click Progress once at 10%, then Reject at the 25% review and see the
actual result and exact restoration. No API or approval-policy change is needed.
The four-phase, stale/replay and emergency campaign remains deferred; completing
this smaller check does not satisfy every original #141 criterion.

The first live attempt, `human-progress-reject-20261103-1`, failed validation
before any step or card because the CLI's `--params` argument submitted a string
rather than an object. Its history remains intact. The corrected request uses
`--body` with a `params` object; it does not restart the failed instance.

The corrected run, `human-progress-reject-20261103-2`, delivered root card
`1793761280.595109` and promoted the existing healthy candidate
`27fca944-c549-433e-a1d4-15684b1c6cd9` to 10%. No reviewer decision was recorded.
The first 30-second sampling wait threw an Error whose message was
`WorkflowTimeoutError: Execution timed out after 30000ms`. The controller only
recognized the unprefixed wrapper message, so it failed closed before the
advertised two-minute review deadline. This is not a human Reject or acceptance.

Native cleanup restored version `f8526596-f9b8-4068-87c0-c517844488a8` at 100%,
deployment `1f00c667-9977-493f-b5ac-5efa8cb84642`. Independent deployment and
health GETs confirmed the exact captured allocation and healthy baseline.
The deployed host version was `f4665dc6-a1f6-48f3-8ee0-d8d4c46d04d1`;
its deployment annotation identifies [unmerged PR #441](https://github.com/ericclemmons/effect-ci-testbed/pull/441).
Source inspected for this run was `6ea26405d920f79d665953fd160b0ec01a0a7316`.
No screenshot or independent human click is claimed.

The local compatibility fix accepts both exact wrapper messages for the expected
duration. It leaves reviewer authority, fixed deadlines, regression handling and
rollback unchanged. Updating the existing sampling fixture to the observed native
message reproduced three failures before the fix; all 30 focused existing runner,
native-ingestion and Slack checks passed afterward. This local result is not
hosted acceptance. Preserve the live host's unmerged work before any separately
authorized deployment or another human window.

Eric subsequently authorized the narrow deployment and coordination with the two
other chats sharing the host. Both owners held host deployments and merges.
The deployment used exact live source `e87d9626a08f11e996d0d950fa9ebc9142b0b0aa`
from [PR #412](https://github.com/ericclemmons/effect-ci-testbed/pull/412), plus only
the runtime timeout hunk from `6f74b9d426cf20928d8a7372ec0791513d12c394`.
A full archive comparison confirmed the sole changed source file was
`test/apps/example-runner/src/hmd-review-runner.ts`; migrated account and version
pins were preserved. Host version `ad120451-a131-45f0-9b4a-96d75fd11969`, deployment
`b5e2d7ac-e69b-4335-9916-9da50e9a5a1f`, retained all 29 binding names/types,
environment metadata, exports, compatibility settings and container metadata.
The prebuilt deployment preserved existing secrets and left containers unchanged.

Fresh run `human-progress-reject-20261103-3` delivered card
`1793761920.502499` and reached the 10% review. It correctly survived three native
30-second wrapped timeouts and the final 23,382-millisecond wait until the fixed
two-minute deadline. No human decision was accepted and no 25% promotion occurred;
the deadline resolver failed closed. This proves the deployed timeout fix and
deadline restoration, not the requested human Progress/Reject acceptance.
Native restoration and independent deployment/health GETs confirmed captured
version `f8526596-f9b8-4068-87c0-c517844488a8` at 100%, deployment
`ad7aa3b1-a51e-4be0-91fd-0382a37498ee`, healthy. The terminal card and restoration
thread were delivered. The human walkthrough remains pending; no new run is
authorized merely by this timeout. Later host deployments must preserve the
runtime fix until its source integration is agreed.

For fresh run `human-progress-reject-20261103-4`, Eric explicitly confirmed he was
ready and reported clicking Progress at 10%. Slack showed a warning that the app
returned an error. Three host request events during the review window confirm
`POST /webhooks/slack` returned HTTP 403 from version
`ad120451-a131-45f0-9b4a-96d75fd11969` in 1–2 milliseconds. This is observed
human interaction with a rejected callback, not absent human participation and
not an accepted Progress decision. Existing logs do not distinguish which
authorization/context guard rejected the request; no authority change is inferred.
No 25% promotion occurred. The full deadline expired, and native restoration plus
independent allocation and health GETs confirmed the captured baseline at 100%,
healthy, deployment `02aa36d3-b852-4449-ba24-29480032271c`.
The callback failure must be diagnosed before another human acceptance attempt.

## Historical reconciliation — October 26, 2026

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

## Deferred full campaign

The following original #141 campaign is deferred, not required for the smaller
prototype check above. It is not dispatch approval. Agree the exact owned
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
