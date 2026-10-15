# Release the checked demo candidate

The demo finalizer now connects its actual workflow result to
`@effect-ci-testbed/cloudflare/reviewed-release`, the existing private release
broker, private review records, graph renderer and the maintained build card.
It is **armed for the owned test branch, but not yet live-release-accepted**.
Eric explicitly authorized browser-delegated test approvals while away. These
must be recorded as delegated tests, not independent human review.
`demoReviewedReleaseEnabled` in `src/demo-release.ts` is now `true`.
No Workflow parameter or project environment can enable it.
Remote runs remain quiet and never start review. Signed GitHub check-suite events
for the selected installation/repository and `refs/heads/demo/live` now select
`DemoCIWorkflow`, with maintained Slack build status. Other branches retain the
normal workflow. GitHub's check-suite event follows a real push; a raw unsigned
push payload cannot select a workflow. The host enrollment remains independent.

```sh
# In a clean demo checkout after the hosted configuration is deployed:
git push origin HEAD:refs/heads/demo/live
```

This is a normal fast-forward push, never a force push. Existing branch history
must be preserved. It builds the exact pushed commit, publishes its checked site
and prepares its candidate. With the host gate armed, the same card requests each
phase decision before the controller can commit the owned test target.
The App remains installed only on its existing selected repositories; no
account-wide installation setting is changed.

Unlike the historical review lab, this controller uses the prepared candidate
returned by this build, not the lab's fixed healthy/failing versions. Before
acquiring a lease it reads the broker's completed candidate receipt and verifies
the exact revision, asset digest, generated module digest, policy and version.
It captures the current prior allocation, probes version-attributed HTTP health,
then runs 10%, 25%, 75% and 100% stages. The health comparison currently requires
a single-version 100% baseline; unsupported mixed baselines fail closed and the
broker restores their full captured allocation.

After each allocation write, a native two-minute sleep precedes the single
100-request cohort. API allocation readback is not proof that the data plane is
ready. This is a bounded settling interval, not a readiness guarantee: missing
candidate observations, foreign attribution or regression still fail closed;
there is no probe-until-green loop or automatic decision.

Each of the 100 requests has a distinct, predetermined
`Cloudflare-Workers-Version-Key` synthetic-client identity ([platform contract](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)). Cloudflare hashes
these keys against the deployment percentages; keys never name a version and
are not chosen or retried based on results. No version-override header, preview
endpoint, quota filling or candidate-only fallback is used. The previous
unkeyed native cohorts returned zero candidate observations both immediately
and after ten seconds, and both correctly restored the baseline. Shared routing
affinity was a hypothesis, not a claimed platform root cause. The fixed native
diagnostic below observed delayed convergence with both keyed and unkeyed
traffic. Two minutes is a conservative measured test policy, not a platform SLA;
every release still measures its own actual cohort and fails closed on missing data.

Every stage requires real authenticated human Progress, even when health looks
good. Sparse observations remain uncertain, never a fabricated health pass.
Missing attribution or conclusive regression cannot be overridden. Reject,
timeout, stale decisions, notification failure or controller failure restore the
captured prior allocation. There is no automatic deadline acceptance. After the
100% decision and ownership check, `complete` leaves the candidate at 100%; it
does **not** run the old lab's success cleanup rollback. An ambiguous commit is
held for reconciliation, never automatically retried or rolled back as if it
had definitely failed. The broker's independent lease/alarm remains authoritative.

Graphs use the actual observed intervals with private image uploads enabled;
missing image delivery remains visibly unavailable. These are closed client HTTP
cohorts, not WOBS ingestion completeness or production SLO proof. The generated
candidate redirects to this same immutable Vite build; this is not Workers Static
Assets upload or a new build.

For a known maintained card with a private image, an explicit Slack
`invalid_blocks` rejection permits only three delayed retries (500/1000/2000 ms)
of the identical serialized update. Root posts, HTTP/transport failures,
malformed or lost acknowledgements and other API errors stop immediately; the
Workflow checkpoint itself still has zero retries and a twenty-second timeout.
Exhaustion fails closed. Native receipts retain only a bounded failure category
and validation-retry count, never upstream text. Ordinary notifications are
unchanged. This uses the historical review host's validation-only exception,
not a retry of an ambiguous update or replacement root card.

## Human decision boundary

`HmdApprovals.registerDemo` pins the private destination to `DemoCIWorkflow`;
the historical lab method still pins `HmdReviewWorkflow`. A stored review cannot
change destinations. Signed Slack callbacks retain the existing app/team/channel,
reviewer, phase, snapshot, token, expiry and single-use fences. A Workflow event
only wakes the controller: it must then read the matching consumed decision from
the private SQLite review object. An actor string or arbitrary event is not
authority. No test-only decision path is deployed.

## Actual push/build acceptance — October 15

A normal fast-forward push of genuine diagnostic changes, revision
`198726b4de236d5eff6c74d0a099a28001b01b82`, to `demo/live` generated signed
GitHub delivery/native instance `6bac9850-c89d-11f1-97b9-f8c7e1b07668`.
The deployed host was merged source `34f2311`; no operator Workflow dispatch,
forged delivery or check-suite retry was used. All 11 actions and nine real
commands completed once; command/publication/preparation retry limits were zero.
The summary plus 11 native GitHub checks independently read back successful.

All 35 notification checkpoints acknowledged the same Slack message
`1792071393.501679`. The built-in browser observed that card change from Running
to Passed, then loaded the newly published immutable Vite URL and clicked Show
message successfully. A read-only test verifies its three raw file hashes against
the native verifier, candidate annotations/bindings and preview health:

```sh
LIVE_DEMO_PUSH=1 CF_BIN="$PWD/apps/effect-ci/node_modules/.bin/cf" \
  node --test apps/effect-ci/src/live-demo-push.test.ts
```

Candidate `658a71c7-4dab-4bc1-82a6-503cb20b44e8` identifies that exact source
and checked asset digest. Its root redirects to the immutable Vite publication;
it is not a second build or Workers Static Assets upload. The production target
retained its prior 100% allocation. No HMD window, human decision, graph upload,
traffic promotion, release commit, repair or model inference occurred.
Queue/execution/total were 2.699/142.924/145.623 seconds, one orchestration sample,
not a benchmark. The earlier branch creation at an already-checked SHA produced
no new suite; that negative evidence remains preserved, not relabeled a pass.

PR260's redacted diagnostics were locally verified and subsequently deployed
from merged `6f16b29`; this successful native build did not exercise a broker error.

## Reproduce the local verification

```sh
node --test packages/cloudflare/src/reviewed-release.test.ts
node --test apps/effect-ci/src/demo-release-runtime.test.ts apps/effect-ci/src/hmd-approval-runtime.test.ts
node --test apps/effect-ci/src/demo-release-error.test.ts apps/effect-ci/src/demo-filesystem-runtime.test.ts
pnpm --filter @effect-ci-testbed/cloudflare check
pnpm --filter @effect-ci-testbed/github-cloudflare check
pnpm --filter @effect-ci-testbed/app check
```

Release preparation failures retain only the fixed broker protocol's stage,
HTTP status and known version ID. Unknown RPC errors are redacted, with a reminder
to inspect the retained run and reconcile pending state rather than retry an upload.
Publication failures similarly identify `stage=publication` without forwarding RPC text.
The hosted-wrapper regression reproduces the original `Effect.tryPromise`
`UnknownError` before the explicit error mapping; it uses a fake broker, not a
new native upload or a rewrite of the original failed history.

The composition test runs the actual local Workflow/finalizer/private SQLite/RPC
path with **fake** health, deployment API, Slack, PNG renderer/upload and human
decisions. It checks one maintained message, four graph stages, commit without
rollback, reject with restoration, and consumed-capability replay denial.
Protocol tests also cover stale decisions, wait failure, invalid health,
regression, foreign candidate evidence and lost commit acknowledgement. They do
not prove native traffic promotion, native graphs or real human approval.

## Activation, permissions and cleanup

### Bounded routing diagnostic (private operator only)

`DemoRoutingDiagnosticWorkflow` / `effect-ci-demo-routing-diagnostic` is a
separate private native history, not a retry of any failed build. Its sole exact
payload is `{ "mode": "observe-fixed-candidate" }`; extra fields, accessors and
caller-selected identities are rejected. Host source pins the already-completed
`cedd7e6` candidate `454d68b9-f3cb-4ffd-9dd7-6d8d8a6cca58` and full receipt.
It revalidates that receipt, captures the existing baseline, acquires the normal
broker lease, promotes only to 10%, and always restores the full prior allocation.
It never uploads, builds, approves or commits a release, and does not alter the
original recovery Workflow's strict `reconcile-original` contract.

Three fixed observations at scheduled 0/30/120 seconds each issue exactly 100
unkeyed and 100 keyed requests, preceded by 100 baseline requests: 700 total,
under the host's default subrequest allowance with broker headroom. Actual start
and end timestamps are retained; cohort/API latency extends the schedule.
No outcome selects another cohort, sleep, key or traffic write. Same-phase broker
readbacks enforce ownership without rewriting the allocation. Every action has
zero retries; the broker recovery lease remains independent.

Reproduce the local fake-service contract:

```sh
node --test apps/effect-ci/src/demo-routing-diagnostic.test.ts apps/effect-ci/src/demo-routing-diagnostic-runtime.test.ts
```

After a merged host build/deploy and fresh idle-controller/allocation/security
preflight, the authenticated operator may create ONE uniquely named instance:

```sh
cf workflows instances create effect-ci-demo-routing-diagnostic \
  --body '{"instance_id":"YOUR-NEW-DIAGNOSTIC-ID","params":{"mode":"observe-fixed-candidate"}}'
```

Preserve a private create-only intent first, then inspect the same instance and
untruncated step outputs; do not repeat creation or overwrite historical receipts.
This adds one Workflow resource on the existing App and reuses its existing
private broker binding/token scope—no public route, credential, account permission,
Slack message or inference. Ordinary Workflow/700 health-request costs apply.
To disable new diagnostic starts, remove this export/configuration in a verified
deployment after the owner restores baseline; never delete its histories or
journal to simulate cleanup. Local tests use fake services; the native evidence
below is a separate execution and readback.

Actual retained diagnostic `coverage-demo-routing-diagnostic-20261015-1`
completed on October 15 using merged host `93ec917`, with the same already-built
`cedd7e6` candidate—no rebuild or upload. The native candidate counts were:

| Scheduled observation | Unkeyed candidate / 100 | Keyed candidate / 100 |
| --- | ---: | ---: |
| 0 seconds | 0 | 0 |
| 30 seconds | 5 | 9 |
| 120 seconds | 12 | 4 |

All seven cohorts (including baseline) had zero unknown outcomes and zero
observed failures. This supports delayed data-plane convergence, not an affinity
bug or a guaranteed readiness deadline. Exactly two target allocation writes
were independently read back: 10% promotion and restoration. Baseline
`09593237-23b2-4873-bd04-88c8e8488840` was restored at deployment
`28046f81-3b35-47f7-9a19-02491e2bc5e1`; the original failed build remained
errored. All thirteen action checkpoints ran once with zero retry limits.
No review, approval, Slack message, release commit or inference occurred.
An independent external GET-only observer also saw both versions; its samples
are not substituted for the native controller's evidence. One read-only full
step-output API fetch hit HTTP 429; complete compact JSON summaries were then
read from the normal history endpoint. No native action was retried.

```sh
LIVE_DEMO_ROUTING_DIAGNOSTIC=1 CF_BIN="$PWD/apps/effect-ci/node_modules/.bin/cf" \
  node --test apps/effect-ci/src/live-demo-routing-diagnostic.test.ts
```

The owned test gate was explicitly authorized by Eric for browser-delegated
approvals. Activation requires an explicit host source change, merged build,
fresh current-resource/security/review preflight and one guarded deployment; do
not bypass any decision or claim delegated tests are independent human approval.
Use the existing broker's fixed
account/target and token, existing Slack app/channel/reviewer and private services.
No new account permission, secret, paid model/provider or deployment authority is
introduced. Real Workflow, storage, health requests, rendering and uploads incur
their ordinary service costs; no inference is involved.

To disable new review starts, restore the host gate to false and deploy verified
merged source. Do not delete active journals, pending decisions, original versions
or historical receipts. Let the owner/broker recover an active release before
changing its controller or target. Browser approvals here require Eric's explicit
delegation; the historical human-only review evidence remains unchanged.
