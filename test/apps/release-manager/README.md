# Fixed-target release manager

Separate, RPC-only Worker holding `HMD_DEPLOY_TOKEN`. It has no public hostname,
HTTP administration, container or credential-exporting method. The token needs
Account → Workers Scripts → Edit on the selected account; the API token itself is
account-scoped, **not** restricted to one Worker. Code fixes both account and
target to `effect-ci-hmd-demo`. Only trusted controller Workers should receive its
service binding. Never give the binding or token to repository code or containers.

Deploy from this directory with a private dotenv secret file:

```sh
cp secrets.example.env .secrets.env
$EDITOR .secrets.env
cf deploy --secrets-file .secrets.env
```

`.secrets.env` is ignored by Git. `cf` uploads its values as Worker secrets on
**this broker only**, not as public environment bindings. Never put the token in
the checked-in template, shell arguments or personal OAuth/refresh credentials.
The controller binds the deployed Worker as `RELEASE_MANAGER`, then calls:

```ts
await env.RELEASE_MANAGER.begin(instanceId, candidateVersion);
await env.RELEASE_MANAGER.promote(instanceId, 10);
// Controller obtains complete, version/window-bound health evidence before advancing.
await env.RELEASE_MANAGER.promote(instanceId, 25);
// ... 75%, 100%, final health gate, then complete(instanceId).
// On regression or exhausted uncertainty: rollback(instanceId).
```

One singleton Durable Object serializes broker calls and stores the owner, exact
previous allocation and a write intent before any deployment change. Successful
phase replay does not redeploy. An acknowledged or reconciled rollback restores
every previous version and percentage. Ambiguous writes remain pending; recovery
matches the deployment annotation and full allocation, never blindly retries POST.
An unresolved intent requires operator review; the broker cannot reset it remotely.

Deployment confirmation makes at most four GETs after its single POST. Only an
exact stale copy of the pre-write deployment (ID, message and full allocation)
permits another read after 250/500/1000 ms. A foreign or malformed read, transport
failure, or exhausted bound retains the pending intent and stops; none retries
the POST. The journal still requires the new ID, exact intent annotation and
complete allocation. These are write-confirmation reads, not health sampling.

### Retained main-release failure and recovery — October 16

Normal merge source `c809b0fa8b5a9cc75ca0a95ac7f360869b4840f3` started native
demo run `c6c016d0-c920-11f1-84a3-ccb51670aff6`. Its actual build/publication and
candidate `e21c0ac8-b7f3-411e-85ed-a0a74ab1878a` succeeded. The first 10% write
created deployment `02841dfe-6ff1-458d-b306-3f2564963f9b`, but immediate
confirmation failed closed, as did the controller's attempted recovery while
that intent was unresolved. No review decision or later promotion occurred.

The later GET-only operator instance `coverage-main-release-reconcile-20261016-1`
matched the SAME intent, deployment annotation and 90/10 allocation. Separate
`coverage-main-release-restore-20261016-1` then restored the exact captured prior
version `7aa076d2-23c6-4550-b197-d7754d4ae7df` at100%, independently read back in
deployment `7936ce1e-a212-4f56-b838-efd4bc5548f5`. The original failed Workflow,
candidate and journal history are preserved. This is operator recovery, not a
completed main release or a retry of the old promotion.

The exact mismatching immediate read was not retained; delayed list visibility
is an inference from the later matching read, not a proven platform root cause.
The regression reproduces an exact stale pre-write list response and verifies
bounded read-only convergence, exhaustion, foreign drift and malformed reads,
always one POST. The confirmation fix needs its own exact-source deployment and
fresh native acceptance; this recovery does not prove it deployed.

Dashboard/external deployment changes are detected before writes, not atomically
fenced by Cloudflare's deployment API. Use this dedicated target with one operator;
do not claim safety against racing external deployment tools. A controller lease
defaults to fifteen minutes (trusted callers may select 30–1800 seconds). The
journal and its Durable Object alarm commit atomically before deployment writes.
`renew(instanceId)` extends a live lease; an expired owner cannot renew, promote
or complete. Expiry does **not** release ownership to a new controller: the alarm
serializes with broker calls and restores the captured allocation first.
Pending/ambiguous writes still require reconciliation; external drift blocks
recovery rather than being overwritten. Failed recovery keeps ownership and
reschedules a one-minute reconciliation attempt, with a redacted operator warning.
Legacy active journals without a deadline still require operator recovery.

This is the mutation boundary, **not** the HMD controller. Health decisions,
telemetry completeness, immutable observation history and live confidence charts
remain controller responsibilities.

## Prepare the actual checked Vite build as a candidate

The existing private broker now also accepts
`prepareCandidate(fullRevision, assetDigest)` from its already-authorized host
binding. Account and target remain fixed to the same `effect-ci-hmd-demo` Worker.
No new repository-selected URL, script/module, token, deployment target, binding,
or caller pool is accepted. The operator's existing Workers Scripts Edit authority
is used for **version upload only**, not traffic promotion.

The broker independently GETs exactly the three public assets from the owned
immutable demo origin, with redirects denied, strict UTF-8/size limits, response
identity and recomputed byte-digest checks. It generates a credential-free release
pointer Worker: `/health` returns its actual version plus build identity, and `/`
redirects to the unchanged immutable Vite build. This avoids mixing HTML/JavaScript
from different Worker versions during percentage routing. It is not a second build,
Workers Static Assets upload, or project JavaScript executing inside this broker.

A separate create-only candidate record is persisted in the SAME singleton SQLite
object **before** the version-upload POST. Existing release journals, owners,
alarms and historical receipts are not reset. Active/pending release ownership
blocks preparation. The candidate index has a 256-revision lifetime capacity, with
no eviction or reset endpoint. A completed identical identity replays its receipt
without network/token access; changed policy/bytes, corrupt, failed or pending
identities fail closed. Uncertain uploads are never automatically retried; inspect
the original commit/digest/module hash and version annotations instead of inventing
a new identity. A validated upload acknowledgement is followed by an independent
version GET and unchanged active-allocation readback before completion. This is
finite prototype retention, not automatic garbage collection. The private native
`CandidateInspectionWorkflow` reads fixed candidate/count/release metadata with no
credentials, uploads, retries or journal writes; its payload must be empty.

An authenticated existing host can call
`reconcileCandidate(fullRevision, assetDigest, existingVersionId)` for a pending
claim. It rechecks the immutable public bytes, generated module identity, actual
version annotations/bindings and unchanged allocation using GETs only, then
completes the original record. It cannot create a claim, upload another version,
deploy traffic, or bypass an active release. Wrong identities remain pending.

### Native upload/readback failure retained

Native instance `d6ac9135-68be-41a8-8e04-42a50049b4ad`, source
`f4860ce5532c3d724db41bed511a787c114971e8`, built and published the actual Vite
assets, then uploaded version `d91c0765-1994-4aad-8aad-f359374c2f45` once.
Its prepare action **failed** because the version API returns `annotations` at
the top level, whereas the original implementation and fake fixture expected
`metadata.annotations`. The corrected real response shape first reproduced the
failure locally, then passed after the parser fix. No upload was retried.

Independent preview `/health` returned that exact version, source and asset digest
`e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23`.
Production remained on its previous allocation; no review, Progress, inference
or traffic promotion occurred. The original native history remains failed and
the original candidate claim remained pending until the explicit reconciliation
below. The failed build history was not retried or rewritten.

The App exports private `DemoCandidateRecoveryWorkflow`
(`effect-ci-demo-candidate-recovery`) using its existing `RELEASE_MANAGER`
binding. It accepts **only** `{ "mode": "reconcile-original" }`; the original
revision, digest, module digest and version above are pinned in host code.
Extra fields, getters and caller-selected identities are rejected. Its one
checkpoint has zero retries and a one-minute timeout. It is separate recovery
history, not a retry or rewrite of the failed build history.

```sh
node --test apps/effect-ci/src/demo-candidate-recovery-runtime.test.ts
# After building/deploying the exact merged broker and App sources as above,
# inspecting current bindings/secrets/Access and confirming no active HMD review:
cf workflows instances create effect-ci-demo-candidate-recovery --body '{"instance_id":"coverage-demo-candidate-reconcile-20261015-1","params":{"mode":"reconcile-original"}}'
```

This authenticated operator command completes the original pending journal only;
it does not start a build, upload a version, start human review or promote traffic.
Save a private create-only intent first and inspect that same instance on an
ambiguous response. Do not dispatch another instance to manufacture success.
Normal Workers/Workflow/storage request costs apply; no model call or additional
credential is required. Remove the recovery Workflow export/configuration to
disable future invocations; retain its history and the original candidate record.

### Verified native reconciliation

`coverage-demo-candidate-reconcile-20261015-1` completed at
2026-10-15 09:39:07 UTC, using exact merged source
`e851d70e694ed634a1f4294d9584b5d08bb9497a` in the App and broker. Its only
checkpoint, `candidate:reconcile-original-1`, ran once with zero retries and
returned the **same** version `d91c0765-1994-4aad-8aad-f359374c2f45`, source,
asset digest and module digest above. The existing pending journal was completed
without a new build, publication, upload or traffic deployment.

Independent version/preview-health readback matched, and production remained at
deployment `7b22d002-d5fb-4d1a-a0e1-662420697c5f`, previous version
`09593237-23b2-4873-bd04-88c8e8488840` at 100%. No human-review window, Slack
decision or inference occurred. This is operator recovery, **not** a completed
push-to-Slack/human-reviewed rollout. Native timestamps give queue 3559 ms,
execution 940 ms and total 4499 ms (one orchestration sample, not a benchmark).

```sh
# Reads the two retained histories, version identity and public preview only:
LIVE_DEMO_CANDIDATE_RECOVERY=1 CF_BIN=cf node --test apps/effect-ci/src/live-demo-candidate-recovery.test.ts
```

```sh
# From the repository root:
pnpm install --frozen-lockfile
node --test test/apps/release-manager/src/*.test.ts packages/cloudflare/src/demo-candidate.test.ts
pnpm --filter @effect-ci-testbed/release-manager check
cd test/apps/release-manager
cf build
# Inspect current private broker configuration and absence of active reviews first.
# Reuse its EXISTING secret binding; do not generate/print/upload a new token:
cf deploy --prebuilt
cd ../../../apps/effect-ci
cf build
# Preserve all current bindings, secrets, Access and existing Workflow/DO state:
cf deploy --prebuilt
cd ../../fixtures/demo
effect-ci run --remote
```

The enrolled demo adds `prepare release` after its actual build/verification/site
publication. Both external-effect actions are durable, zero-retry and bounded-time;
only the private broker owns `HMD_DEPLOY_TOKEN`. Version/Worker requests, build
containers, and storage remain metered; no inference is used. This does **not**
begin a release, shift traffic, create a human-review window, call Progress, or
declare health/commit. Those require the separate real rollout/controller flow.
Cleanup: remove the host's candidate-preparation call to stop new uploads, retaining
all candidate/release records and versions; deleting them needs a deliberate
operator decision. Never clean old candidates to manufacture another retry.

Tests include real local workerd/RPC/SQLite concurrent claim/reload with a FAKE
Cloudflare API, upload readback and lost-ack pending denial. They are not native
candidate upload or rollout evidence. Record native acceptance separately.

## Verified execution

`coverage-release-broker-20261010-4` completed through the separate
`effect-ci-probe-release-broker` Cloudflare Workflow on October 10, 2026:

- Candidate received 10% in deployment `c7af880c-2849-47a3-95a1-86894be0f38c`.
- Repeating the same promotion returned the same deployment and journal sequence.
- Rollback restored the healthy baseline at 100% in
  `6ac41112-480d-41af-9c69-461af86d7476`.
- The controller used only `RELEASE_MANAGER` RPC; the deployment secret remained
  exclusively in the private broker. No container executed this probe.

The initial probe exposed unsupported Workers `redirect: "error"` and incomplete
write acknowledgements. The adapter now uses `manual`, rejects redirects, and
confirms writes by reading the latest allocation and owner annotation. Nine
regressions include a credential-free native Workers runtime test.
An ambiguous rollback intent was also reconciled read-only in instance
`cf_8e2d3088f2e90701e3eeb73044263b40ca20da2156ac9778a62504e33a5fae76`;
no deployment POST was repeated.

The probe is invoked through the authenticated Cloudflare API:

```sh
cf workflows instances create effect-ci-probe-release-broker --instance-id my-broker-probe
# Read-only recovery of an existing owner's pending intent, when needed:
cf workflows instances create effect-ci-probe-release-broker \
  --body '{"params":{"reconcileOwner":"existing-owner"}}'
```

The `--params` flag serializes a string; use the object-valued body for recovery.
This is not yet full 10/25/75/100 health-mediated release or WOBS/chart verification.

## Independent controller-death recovery

On October 10, 2026, fixture
`cf_dfbea9089fb2f0cec1b67d0fe04106f59a443a4683c689e19b0f347b089eece6`
promoted the failing candidate to 10% in deployment
`bf7c693a-7799-46b6-b0e3-092bad70da9c`, then was explicitly **terminated** at
18:20:13 UTC without Workflow rollback. The broker's persisted thirty-second
deadline fired independently and restored the original baseline at 100% in
`d599b570-9a32-485a-ab46-7e514ad757cc` at 18:20:30 UTC. No controller cleanup
step ran and no operator rollback was dispatched.

Read-only assertions check the terminated run, absent cleanup, prior allocation,
restoration annotation and timing:

```sh
HMD_ABANDON_INSTANCE=cf_dfbea9089fb2f0cec1b67d0fe04106f59a443a4683c689e19b0f347b089eece6 \
HMD_RECOVERY_DEPLOYMENT=d599b570-9a32-485a-ab46-7e514ad757cc \
node --test test/apps/example-runner/ci/tests/live-recovery.test.ts
```

The dedicated authenticated probe accepts `{"params":{"abandon":true}}` only to
create this short-lease test on the fixed demo. Terminate it during its two-minute
sleep, without `--rollback`, to exercise the independent alarm. Do not run it
alongside other releases. This does not simulate every possible outage: recovery
still depends on broker storage, alarm scheduling and the deployment API being
available, and unresolved writes or drift require operator review.

The live HMD controller also renews before each observation. Post-change regression
`cf_6b5d0a21168d1fef60a2a7d7b93f24d4893320ff0eef9f5355af0b3d3e3f4e29`
completed an uncertain-to-regression transition and normal broker rollback in
`f157265b-4ae8-40b2-ac95-416fc78705fd`; its read-only HMD assertions pass.
