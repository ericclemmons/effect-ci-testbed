# Release the checked demo candidate

The demo finalizer now connects its actual workflow result to
`@effect-ci-testbed/cloudflare/reviewed-release`, the existing private release
broker, private review records, graph renderer and the maintained build card.
It is **implemented and locally verified, but not armed or live-accepted**.
`demoReviewedReleaseEnabled` in `src/demo-release.ts` remains `false` while the
reviewer is away. No Workflow parameter or project environment can enable it.
Remote runs remain quiet and never start review. Signed GitHub check-suite events
for the selected installation/repository and `refs/heads/demo/live` now select
`DemoCIWorkflow`, with maintained Slack build status. Other branches retain the
normal workflow. GitHub's check-suite event follows a real push; a raw unsigned
push payload cannot select a workflow. The live review gate remains independent.

```sh
# In a clean demo checkout after the hosted configuration is deployed:
git push origin HEAD:refs/heads/demo/live
```

This is a normal fast-forward push, never a force push. Existing branch history
must be preserved. It builds the exact pushed commit, publishes its checked site
and prepares its candidate, but cannot promote traffic while the gate is false.
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

## Human decision boundary

`HmdApprovals.registerDemo` pins the private destination to `DemoCIWorkflow`;
the historical lab method still pins `HmdReviewWorkflow`. A stored review cannot
change destinations. Signed Slack callbacks retain the existing app/team/channel,
reviewer, phase, snapshot, token, expiry and single-use fences. A Workflow event
only wakes the controller: it must then read the matching consumed decision from
the private SQLite review object. An actor string or arbitrary event is not
authority. No test-only decision path is deployed.

## Reproduce the local verification

```sh
node --test packages/cloudflare/src/reviewed-release.test.ts
node --test apps/effect-ci/src/demo-release-runtime.test.ts apps/effect-ci/src/hmd-approval-runtime.test.ts
pnpm --filter @effect-ci-testbed/cloudflare check
pnpm --filter @effect-ci-testbed/github-cloudflare check
pnpm --filter @effect-ci-testbed/app check
```

The composition test runs the actual local Workflow/finalizer/private SQLite/RPC
path with **fake** health, deployment API, Slack, PNG renderer/upload and human
decisions. It checks one maintained message, four graph stages, commit without
rollback, reject with restoration, and consumed-capability replay denial.
Protocol tests also cover stale decisions, wait failure, invalid health,
regression, foreign candidate evidence and lost commit acknowledgement. They do
not prove native traffic promotion, native graphs or real human approval.

## Activation, permissions and cleanup

Keep the host gate false until Eric is present and the authenticated push policy
is integrated. Activation requires an explicit host source change, merged build,
fresh current-resource/security/review preflight and one guarded deployment; do
not start a review merely to test the gate. Use the existing broker's fixed
account/target and token, existing Slack app/channel/reviewer and private services.
No new account permission, secret, paid model/provider or deployment authority is
introduced. Real Workflow, storage, health requests, rendering and uploads incur
their ordinary service costs; no inference is involved.

To disable new review starts, restore the host gate to false and deploy verified
merged source. Do not delete active journals, pending decisions, original versions
or historical receipts. Let the owner/broker recover an active release before
changing its controller or target. Never self-approve a native human review.
