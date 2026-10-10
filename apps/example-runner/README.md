# Hosted example checks

> How do I verify the same consumer workflows in a real Cloudflare account?

This app imports the examples unchanged and gives each its own native Workflow.
It is separate from the GitHub/Slack service, has no production credentials, and serves no HTTP
control plane. Instance creation and inspection require Cloudflare API credentials.

The fixed-target release-broker probe additionally holds a service binding to
[`apps/release-manager`](../release-manager/README.md), never its deployment token.
It is trusted host code, not a capability available to imported repository actions
or containers. `coverage-release-broker-20261010-4` verified real 10% promotion,
same-phase replay without redeployment, and exact baseline rollback.

`HostedHmdWorkflow` verifies healthy 10/25/75/100 promotion, non-retryable regression
and exhausted uncertainty through real closed client HTTP cohorts and immutable
confidence SVGs. Independent broker recovery after controller termination is also
verified; WOBS completeness and notification images remain unverified. See the
[HMD evidence and remaining matrix](../../examples/health-mediated-release/README.md#hosted-regression-controller-proof).
No notification token or deployment credential is present in this controller.

`WobsCohortProbeWorkflow` separately verifies twenty native terminal fetch outcomes
through the Analytics SQL binding. It captures independent `CF-Ray` receipts before
querying, waits for every expected receipt, and counts neither custom logs nor missing
records as success. It does not yet drive the release controller or notifications.

`WobsReleaseWorkflow` is a separate, fixed-target regression lab. It first closes
100 baseline native outcomes, promotes the deliberately failing demo version to
10%, and gates rollback only on native SQL outcomes matched to independently
captured edge receipts. Each bounded cohort waits for delayed ingestion; missing,
weighted, conflicting or misattributed outcomes stay uncertain. Its first candidate
cohort cannot meet the minimum sample count, so it exercises a native one-minute
uncertainty wait before a possible non-retryable SLO breach. The broker restores
the complete prior allocation and independently recovers if the controller dies.
There are at most 1,010 HTTP requests, ten observations and six SQL attempts per
cohort. HTTP status validates receipt collection but is not the health gate.
This does not prove healthy four-phase WOBS promotion, ambient-traffic completeness,
Workflow/cron outcomes or notification image delivery; no Slack notification is sent.

From the repository root:

```sh
pnpm install
pnpm --filter @effect-ci-testbed/example-runner exec cf deploy
```

Create an instance against a committed revision, using the authenticated `cf` CLI:

```sh
cf workflows instances create effect-ci-example-node-npm \
  --body '{"instance_id":"npm-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"COMMIT_SHA"}}'

cf workflows instances get npm-1 \
  --workflow-name effect-ci-example-node-npm --simple true
```

Use object-valued `params` and `instance_id` in `--body`. In the current CLI,
`--params` sends a string rather than parsing JSON, and an `id` body field does not
select the instance ID. Verify the returned ID instead of assuming it was honored.

| Example | Native Workflow |
| --- | --- |
| [npm](../../examples/node-npm) | `effect-ci-example-node-npm` |
| [Zero-config tasks](../../examples/zero-config) | `effect-ci-example-zero-config` |
| [pnpm](../../examples/node-pnpm) | `effect-ci-example-node-pnpm` |
| [Optional checks](../../examples/optional-checks) | `effect-ci-example-optional-checks` |
| [Durable workspace](../../examples/cloudflare-runner) | `effect-ci-example-workspace` |
| [Conditional deployment](../../examples/conditional-deploy) | `effect-ci-example-conditional-deploy` |
| [Python toolchain](../../examples/cloudflare-toolchain) | `effect-ci-example-python-toolchain` |
| [System packages](../../examples/system-package) | `effect-ci-example-system-package` |
| [Package-manager downloads](../../examples/package-manager-cache) | `effect-ci-example-package-manager-cache` |
| [Vite+ task cache](../../examples/vite-plus-cache) | `effect-ci-example-vite-plus-cache` |
| [Turborepo task cache](../../examples/turborepo-cache) | `effect-ci-example-turborepo-cache` |
| [Custom runner image](../../examples/custom-runner-image) | `effect-ci-example-custom-runner-image` |
| [Isolated snapshot fanout](../../examples/snapshot-fanout) | `effect-ci-example-snapshot-fanout` |
| [Project Node version](../../examples/node-version) | `effect-ci-example-node-version` |
| [Mise runtimes](../../examples/mise-toolchain) | `effect-ci-example-mise-toolchain` |
| [Exported actions](../../examples/exported-actions) | `effect-ci-example-exported-actions` |
| [Deployment hooks](../../examples/deploy-hook) | `effect-ci-example-deploy-hook` |
| [Source-only formatter](../../examples/dynamic-worker-checks) | `effect-ci-example-source-checks` |
| [Isolated Dynamic Worker formatter](../../examples/dynamic-worker-checks) | `effect-ci-example-dynamic-formatter` |
| [Cache input correctness](../../examples/cache-policy) | `effect-ci-example-cache-policy` |
| [Retries and timeouts](../../examples/execution-policy) | `effect-ci-example-execution-policy` |
| [Action-owned rollback](../../examples/rollback-compensation) | `effect-ci-example-rollback` |
| [Portable artifacts](../../examples/portable-artifacts) | `effect-ci-example-portable-artifacts` |
| [Host-only outbound credentials](../../examples/secret-outbound) | `effect-ci-example-secret-outbound` |
| [Cloudflare Artifacts source](../../examples/artifacts-source) | `effect-ci-example-artifacts-source` |

For local Dynamic Worker execution, start `pnpm --filter
@effect-ci-testbed/example-runner exec cf dev`. Open the printed local explorer and
create an `effect-ci-example-dynamic-formatter` instance with the same repository
and full commit SHA parameters above. This exercises WorkerLoader locally, rather
than the default Node formatter. The current CLI's `--local` instance commands do
not connect to this Vite dev server; use its explorer instead.

A successful deployment alone does not verify an example. Inspect the completed
instance, action statuses, commands, and checkpoint history before marking the matrix.
Each run gets a distinct instance ID, so previous evidence is never overwritten.

The pnpm adapter bootstraps the pinned `pnpm@12.8.1` binary on the managed image,
just as the GitHub comparison uses `pnpm/action-setup`. This belongs to runner setup,
not the portable workflow. Project dependencies still install with the frozen lockfile.

To exercise event conditions, include a normalized event in instance parameters:
`"event":{"type":"push","ref":"refs/heads/main"}`. The conditional example
must run its echo-only deployment for that event and skip it for a pull request.
The source always uses the supplied immutable revision, independently of event/ref.

## Verified runs

### Closed native WOBS cohort

`cf_71ce7065194ffed474d86f9db4a30c25b04553aac9952bc59be06a5a597ee16a`
completed on 2026-10-10 UTC, host deployment
`4926a8ec-5bd4-4e69-a32f-b7ace26406e6`, Workflow version
`3a8c22b8-4855-490d-81dc-91cf32f8d8bb`. Twenty healthy requests returned twenty
unique edge receipts. The first query returned zero records and remained uncertain;
after a native 30-second wait, all twenty terminal `cf-worker-event` rows arrived
with sampling interval 1, the pinned baseline version and zero failures. Twenty
additional custom log rows were excluded. There were no missing, conflicting or
rejected native records. No traffic allocation changed and no Slack message was sent.

An earlier query-string identity probe
`cf_1a8619686e92846dbaf58babd434e6e0ab95bd414140d3af409a425bc6de49f0`
correctly stayed incomplete: query values are redacted. The adapter uses independent
edge receipts instead; it does not disable query/header redaction or expose raw logs.
The [read-only assertion](ci/tests/live-wobs.test.ts) inspects the recorded run:

```sh
WOBS_COHORT_INSTANCE=cf_71ce7065194ffed474d86f9db4a30c25b04553aac9952bc59be06a5a597ee16a \
  node --test apps/example-runner/ci/tests/live-wobs.test.ts
```

This closes only that controlled workload, not ambient traffic or a global ingest
watermark. The [binding documentation](https://developers.cloudflare.com/analytics/sql-api/workers-binding/)
currently says Log Explorer datasets are unsupported; this account's observed query
success is experimental evidence, not a supported production contract. Full WOBS
four-phase release gates, Workflow/cron terminal cohorts and live notification charts remain open.

### Native WOBS-driven regression rollback

`cf_6355fef9b88f3ab55f77be4bd458c17c483d7f8853f761a6f0e327522eac12b8`
completed at 2026-10-10 21:22:36 UTC, host deployment
`cc0e8651-9c4a-4cdd-b080-5d8a8c27bf0c`, Workflow version
`2e78eeb4-05ed-45ec-a271-ef9a778efff8`. Native SQL closed all 100 healthy baseline
outcomes, then all four mixed-version cohorts (10, 100, 100, 100 requests).
Each first query had zero rows; each cohort closed after a native 30-second
ingestion wait with no missing, conflicting, sampled or invalid native outcomes.

Three uncertain observations each slept a native minute. The final 33/33 failing
candidate outcomes crossed the 10% absolute SLO: candidate bounds `[55.98%, 100%]`,
baseline bounds `[0%, 27.38%]`. The conclusive health step executed once despite
ten configured retries, and broker rollback restored the full baseline allocation
in deployment `c9275efa-74a5-4961-bfda-98762e297d88`. Four complete immutable SVG
snapshots remain in the output. No Slack message was sent or production release
committed. These are controlled closed-cohort bounds under the estimator's
independent, stationary-trial assumptions, not proof of causal production regression.

The [read-only assertion](ci/tests/live-wobs-release.test.ts) verifies recorded
native ingestion, uncertainty waits, non-retryable rollback and complete charts:

```sh
WOBS_RELEASE_INSTANCE=cf_6355fef9b88f3ab55f77be4bd458c17c483d7f8853f761a6f0e327522eac12b8 \
  node --test apps/example-runner/ci/tests/live-wobs-release.test.ts
```

The example stays 🔜: healthy four-phase WOBS gates, ambient completeness,
Workflow/cron terminal outcomes and live notification images remain unverified.

### Bounded larger native cohorts

`WobsBatchProbeWorkflow` verifies 1,000 independent baseline receipts without a
release broker call or notification. SQL reads now use bounded 250-receipt partitions,
then reconcile the entire manifest together: duplicates across partitions or
versions cannot create extra independent trials. The receipt manifest remains
below the checkpoint size budget. Collection stops on an unknown receipt or its
bounded deadline rather than replacing lost requests.

The first run `cf_82d6e1fb1610e61e91fa7e0a0a3936fa5334321bca490d2d634dcae050192ad6`
correctly stayed incomplete with 998 native outcomes after six queries. A second
diagnostic run `cf_85407e24366d55959201192cc95e5944e478b1fff9fba30b50b6ca8a9ec2a54d`
stayed incomplete with 988. An independently labelled wider-window diagnostic
found all 1,000 outcomes, including native timestamps up to 14 milliseconds past
the original close. It did **not** repair the frozen sample or advance any gate.
This establishes a boundary mismatch, not whether its cause is clock skew or
post-response terminal completion. HTTP receipt completion is not a native
terminal-completion barrier.

The final probe uses a real native one-second settling wait **before** freezing
its window, rather than padding timestamps after querying. Instance
`cf_246b671f5c04929ed0741629d8edc78b5fae2d96f8fa9bed11d5ea718b9d4b44`
completed at 2026-10-10 21:41:30 UTC, host deployment
`92dd7300-e62e-480e-b1ae-75a997e7e1b3`, Workflow version
`f9ad2715-8bda-4ecb-909c-929f05ab8ef6`. Its first query had no rows; after a
native 30-second ingestion wait, every expected native outcome arrived, with
sampling interval 1, zero failures and no missing, conflicting or invalid rows.
The wait is not a universal completeness guarantee: every exact native receipt
is still required, and late/out-of-window outcomes remain uncertain.

Read-only positive and negative assertions both pass:

```sh
WOBS_BATCH_INSTANCE=cf_246b671f5c04929ed0741629d8edc78b5fae2d96f8fa9bed11d5ea718b9d4b44 \
WOBS_BATCH_INCOMPLETE_INSTANCE=cf_85407e24366d55959201192cc95e5944e478b1fff9fba30b50b6ca8a9ec2a54d \
  node --test apps/example-runner/ci/tests/live-wobs-batch.test.ts
```

This is a prerequisite for larger healthy-release samples, not proof of healthy
four-phase WOBS promotion, ambient ingestion or causally independent production traffic.

`WobsLargeBatchProbeWorkflow` then verified a 5,000-receipt checkpoint and
closed all 5,000 native outcomes in instance
`cf_97719d0328e9f9b97135b338b21bbf70c7e7ca94972a8d78b39581b3258a2901`,
Workflow version `fe9426be-2bcd-4a12-9869-1fd445df855d`, host version
`b128acae-ab5a-4d73-bb13-50dd42ce17aa`. The read-only
[large-cohort assertion](ci/tests/live-wobs-large-batch.test.ts) passed: zero
missing, conflicting or invalid outcomes, sampling interval 1, zero failures,
and no release or notification steps.

An earlier 5,000-receipt run
`cf_68d9c40b9bb2bf7d05372f63057d5cf541d16526767042eafb23fed4b0a1f791`
failed on SQL rate limiting after its collection checkpoint succeeded. Its
history remains intact. Larger SQL partitions reduce query volume without
weakening global identity reconciliation; native-only filtering excludes custom
logs before the row limit, and a saturated row limit is rejected rather than
treated as complete. Bounded exponential backoff is permitted only when the
binding explicitly reports `retryable: true`, not by matching error text.
See the [binding error contract](https://developers.cloudflare.com/analytics/sql-api/workers-binding/)
and [SQL limits](https://developers.cloudflare.com/analytics/sql-api/limits/).
These observations establish neither a fixed rate-limit quota nor universal
availability of the experimental native dataset.

```sh
WOBS_LARGE_BATCH_INSTANCE=cf_97719d0328e9f9b97135b338b21bbf70c7e7ca94972a8d78b39581b3258a2901 \
  node --test apps/example-runner/ci/tests/live-wobs-large-batch.test.ts
```

### Native healthy controller: fail-closed evidence

`WobsHealthyWorkflow` applies the native adapter to all four guarded promotion
phases. Each phase starts with an inconclusive ten-request cohort, then collects
bounded independent cohorts and evaluates the pinned baseline/candidate windows.
The maximum budget is 105,140 requests plus 7,650 SQL calls, including explicit
retryable service failures, with 10,000 subrequests reserved for checkpoints,
broker calls and recovery. Lease renewals protect longer collections and reads;
the broker alarm remains independent of controller cleanup.

The first real attempt,
`cf_e3e11b3f1e107ce642cd6d96b1c18b7bf4231788d2696bcad16a00ef6ea89e6e`,
**failed closed** at 10% on October 10, 2026. Its baseline and first two larger
cohorts closed, but the third cohort remained incomplete across six native reads:
4,935 stored rows, 71 missing expected outcomes and six rejected native rows.
The read-only fixed-window diagnostic
`cf_1d8a63fb13e9d8c44bb88d355dc4f63cce29736160caf1383e29f04ec2ef1217`
identified 4,929 weight-1 rows and **six weight-10 rows**. Those sampled rows
cannot substitute for independent unsampled trials. The diagnostic did not
reconstruct missing receipts, repair the frozen window, or advance a gate.

Rollback restored the old baseline at 100% in deployment
`177449ea-0692-4b7d-97ff-c595d1c8c432`, independently confirmed through the
deployment API. There was no 25% promotion or Slack notification. The read-only
[incomplete-evidence assertion](ci/tests/live-wobs-healthy.test.ts) passed:

```sh
WOBS_HEALTHY_INCOMPLETE_INSTANCE=cf_e3e11b3f1e107ce642cd6d96b1c18b7bf4231788d2696bcad16a00ef6ea89e6e \
  node --test apps/example-runner/ci/tests/live-wobs-healthy.test.ts
```

Synthetic collection now paces groups of five with 75 milliseconds between groups
and stops at a 90-second collection deadline, without replacing unknown outcomes.
This is a workload-control experiment, **not** a sampling guarantee or fixed
platform threshold. Every native outcome and weight must still validate. The
[observability API contract](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
distinguishes ingestion sample weights from query `abr_level`; weighted
aggregates are not exact independent counts, even when query `abr_level` is 1.

The paced baseline prerequisite
`cf_0bba4149365e4ba8784676124bcdf7613551d0b457487ed5e8d4f91281e260c4`
closed all 5,000 unique weight-1 outcomes after its initially incomplete 4,738-row
read and a native ingestion wait. Its read-only assertion passed, on host
`f50fd003-5d90-4516-8ac0-a3a6c0baabe5`, Workflow version
`45b65b38-7fed-4881-a5b9-9073f7bec334`. This is evidence for that exact paced
cohort, not a promise that pacing prevents all future sampling.

Healthy four-phase native promotion, consumer deployment integration and live
notification images remain unverified. A successful lab will still restore the
baseline and report `releaseCommitted: false`, not commit a production release.

### Initial binding and version prerequisites

`coverage-hmd-analytics-20261010-1` verified the Analytics SQL Worker binding with
a real `logs.workersLogs` query (zero matching host rows). Worker deployment
`19ccc182-96ad-4219-8fd2-29caf0974775`, Workflow version
`702957da-d883-46b4-acc2-bc6a0dc6c91a`.

`coverage-hmd-analytics-20261010-2` then read ten real demo Worker rows, exposing
`$workers.scriptVersion.id`, `hmd.versionId`, `hmd.outcome`, and `hmd.invocation`;
the observed sample intervals were 1. Worker deployment
`7ef6e40a-c16d-4cf1-b471-80acc3bf6d7c`, Workflow version
`f57c2a24-f662-4227-ae98-05fb71979ec7`. Only attribute names, not raw logs or request
metadata values, were returned. This establishes binding and schema availability,
not population completeness, statistical independence, or rollout health.

The final restricted-output probe `coverage-hmd-analytics-20261010-3` also completed:
Worker deployment `7aafb0c3-e2ea-47ac-ace7-c29551f4c9da`, Workflow version
`d0695917-f932-4266-a2f2-3b7213dfd056`. It returned only allowlisted attribute names,
the observed baseline UUID `09593237-23b2-4873-bd04-88c8e8488840`, sampling diagnostics,
and query statistics. It never returned raw request metadata or log messages.

The dedicated [HMD demo](../hmd-demo) baseline
`09593237-23b2-4873-bd04-88c8e8488840` returned 20/20 healthy requests. Candidate
`02de9b2e-95d0-49e6-b787-467e25c5a65c` was uploaded with failure rate 1; its preview
returned 503 and its exact version ID. Deployment
`bfe54ed8-5cfb-4fb6-b296-15c27ee186b8` still allocated 100% to the baseline, and the
normal URL remained healthy after candidate upload. No candidate traffic allocation
or production application was changed by that prerequisite test. Subsequent
[hosted HMD runs](../../examples/health-mediated-release/README.md#hosted-regression-controller-proof)
verified progressive promotion and rollback; live notification images and complete
WOBS cohorts remain unverified.

`coverage-secret-outbound-20261009-1` completed three native steps with source
`36ea21ebbaaa2b972d917418fbffb7b59de2eac6`, Worker deployment
`695fb261-0107-4a1f-b717-4dd499604186`, and Workflow version
`2ca8f16b-932f-4414-90be-96672491dbd5`. Checkout published snapshot
`6a1116f7-ca02-4eec-9246-6044cd7396e2`; the consuming action restored it in its
isolated container and printed `host-authentication-verified`. The command contained
only the public placeholder, not the generated host-vault credential. This proves
the HTTP virtual-host credential boundary with a test-only verifier, not an actual
third-party token, TLS interception, or total outbound network confinement. Local
regressions cover denied destinations/operations, redirect rejection, and suppression
of reflected credentials and errors.

### Artifacts-backed source proof

### Fail-once retry proof

`coverage-retry-20261010-1` completed one native step, `action:"flaky test"-1`:
attempt 1 failed with `Simulated transient failure on attempt 1`, then attempt 2
started exactly 1,000 ms after the first attempt ended and succeeded. Both retries
and delay are native policy, with no container or checkout. Host deployment
`718d41a9-0ea5-4a1f-9d37-ec3c48ba1ff0`, Workflow version
`333a4006-65f5-4454-be44-1a39c99b27fb`. The repository/revision parameters were
unused; the check body is bundled in that Workflow version.

### Artifacts source history

The dedicated `examples/artifacts-source` consumer passed in
`coverage-artifacts-focused-20261010-1` at source
`e8faf6e46a9dde90067658d87d128c71796ed8c0`, using repository
`default/effect-ci-artifacts-focused`. Its import-issued Git token was revoked
before execution. All three native steps complete: binding materialization,
snapshot `eaaa23aa-2a11-4743-ab7f-296172b79c82`, and downstream snapshot-backed
read returning `source from artifacts`. Worker deployment
`b4a531b2-8e32-4838-a6aa-98237568a9ae`, Workflow version
`69000ec6-9e0f-4912-a198-cd6663570ecd`.

The earlier shared source-provider proofs below remain historical evidence for
the exporter; the dedicated consumer is independently verified above.

`coverage-artifacts-source-20261010-1` completed three native steps using repository
`default/effect-ci-source-example` at commit
`5b8ce90769edaf5578f8c52a764de5f2e85e58f5`: Worker-binding source materialization,
checkout checkpoint, and a downstream snapshot-backed read of `source.txt` returning
`portable source`. Both plan nodes completed. Worker deployment
`9a17c1af-2f2b-4879-9cc4-d6872c658953`, Workflow version
`03ae14a4-e64d-4cd6-843a-bce0717a4c0f`, snapshot
`baecaad9-bacb-4aec-a9b3-627c25eb2f80`. The import-issued Git token was revoked
before this run; only the Worker Artifacts binding supplied repository access.

The final manifest-bounded implementation at host commit `2fa92f6` was independently
re-proven by `coverage-artifacts-source-20261010-2`: all three native steps complete,
Worker deployment `00cad204-2cc0-4789-a99c-9fbc1d3cd7d0`, Workflow version
`73662cd3-edbf-4312-9041-5a38dd9b7088`, snapshot
`7266ae3f-c4ab-446a-a649-9576998b8f78`. Source commit and downstream contents match
the first proof. This is a source-provider proof, not an R2 or DO materializer claim.

The first hosted batch used source revision
`bfb695aa910e550c9bfc0a1412c1b4baefd75f7a`. Each instance retains its pinned
Workflow version and native history. These are real account runs, not local simulation.

| Example | Instance | Verified result |
| --- | --- | --- |
| npm | `coverage-node-npm-20261008-2` | checkout/install/lint/test/build complete; 34 native steps |
| pnpm | `coverage-node-pnpm-20261008-6` | frozen install/format/lint/test/build complete; 47 native steps; source revision `caba617c57ddc664020b955b63c275b8e4670256` |
| Optional checks | `coverage-optional-checks-20261008-2` | required lint passes; optional format warns; workflow succeeds; 25 steps |
| Durable workspace | `coverage-workspace-20261008-3` | checkout/install/build complete with live reuse disabled; 6 steps including workspace checkpoints; source revision `caba617c57ddc664020b955b63c275b8e4670256` |
| Main push condition | `coverage-conditional-push-20261008-1` | checkout and echo-only deploy complete; 4 steps |
| Pull-request condition | `coverage-conditional-pull_request-20261008-1` | deploy skipped, condition retained in plan, no container steps |
| Python toolchain | `coverage-python-toolchain-20261008-1` | apt installs Python/pip; pinned build tools produce a Python package; 7 native steps; source revision `caba617c57ddc664020b955b63c275b8e4670256` |
| System package | `coverage-system-package-20261008-1` | apt installs ImageMagick; downstream action verifies the binary; 6 native steps; same source revision |
| npm download cache, warm | `coverage-npm-cache-warm-20261008-1` | frozen install populates the cache; dependency verification passes; 22 native steps; same source revision |
| npm download cache, fresh offline run | `coverage-npm-cache-offline-20261008-2` | distinct instance restores the cache, runs `npm ci --offline`, and verifies the installed dependency; 23 native steps; same source revision |
| Vite+ task cache | `coverage-vite-plus-hit-20261008-2` | fresh instance reports `cache hit, replaying`, 201 ms saved; 11 native steps; source revision `2fed7a1b3410566cf381acf95eb00d13e48e35d8` |
| Turborepo task cache | `coverage-turborepo-hit-20261008-1` | fresh instance reports 1 cached task, matching hash `f37d6ec47086f918`, 85 ms task run; 11 native steps; same source revision |
| Clean-source cache regression | `coverage-npm-cache-offline-20261008-3` | offline install and dependency verification pass after removing stale untracked files; 23 native steps; same source revision |
| Custom runner image | `coverage-custom-image-20261008-1` | checkout checkpoint restored into the project Dockerfile image; baked-in `Python 3.13.5` verified; 3 native steps; source revision `bc50897f2d6ff8a388bcc6a0af22886f89bfc2c4` |
| Isolated snapshot fanout | `coverage-snapshot-fanout-20261008-1` | prepare runs once; left/right start together and independently overwrite the same filename; 8 native steps with live reuse disabled; source revision `55be3e8c7bff809aa9a8a910f888bc86613922e0` |
| Project Node version | `coverage-node-version-20261009-1` | installs Node 22.20.0 and verifies the exact version after restoring its checkpoint; 8 native steps; source revision `931bb78e21dddb1ef3ac5db80969dea1e8cddeec` |
| Mise runtimes | `coverage-mise-toolchain-20261009-1` | installs Node 22.20.0 and Python 3.13.7 from mise.toml; both version checks pass after checkpoint restoration; 11 native steps; same source revision |
| Portable artifacts | `coverage-portable-artifacts-20261009-1` | publishes `dist/worker.js` to snapshot `34dc7cf5-d259-4fbb-9f0f-6043dd0b19fb`, restores it in a downstream action, verifies the file, and commits that workspace; all 7 native steps and 3 logical actions complete; source `9678a29d9b700d1a2f6d33b9657cc6b38af91efe` |

The artifact proof retains publish/restore directions, artifact name `worker`, and
owned path `dist/worker.js` in its plan. Worker deployment
`13e5f98a-9dad-4588-85a4-9d7fd0aa5dee` runs the unchanged consumer workflow, using
`standard-1` consistently with live workspace reuse disabled. Its native Workflow
version is `336fe322-94e6-43bc-9eb7-46959709680f`. This proves the snapshot resource
boundary, not a real build/deployment or cross-account artifact retention.

View these in **Workers → Workflows → instance** in the deploying account, or use
`cf workflows instances get INSTANCE --workflow-name WORKFLOW --simple true`.

The pnpm runner uses `standard-1` for both initial startup and snapshot restoration.
Selected standalone projects ignore a parent pnpm workspace; an actual monorepo root
with its own `pnpm-workspace.yaml` retains normal workspace behavior.

For the download-cache example, pass
`"event":{"type":"workflow_dispatch","payload":{"offline":false}}` to the warm
instance, wait for completion, then use a new instance ID with `offline: true`.
Inspect the install command in the returned plan to confirm `--offline` was used.
The cache namespace is specific to this repository and example, not shared tenants.

Task-cache proofs use a warm instance followed by a separate instance at the same
source revision. Checkout removes untracked build outputs and old dependencies,
preserving only declared cache paths. The next task restores its output from cache.
Turbo's native remote-cache API is disabled in this hosted proof; the runner transports
its filesystem cache. Vite+ detects the enclosing monorepo and uses the root
`node_modules/.vite/task-cache`, so the adapter also preserves that location.

The custom-image adapter builds the example's Dockerfile as a named image with
`cf deploy`; Docker must be running for this build. Other workflows continue to
select Cloudflare's managed Trixie image. Its hosted proof disables live workspace
reuse so the downstream check must materialize the preceding checkpoint.

The Node-version and Mise adapters use the host's `Dockerfile.mise`. It copies the
official Mise 2026.9.11 static binary from a digest-pinned image alongside the
Sandbox 1.0 shim; project runtimes are installed by the unchanged consumer actions,
not baked into the image. Both proofs disable live reuse and verify the installed
tools after restoring durable snapshots. These runs prove reuse within a Workflow,
not a cross-instance Mise cache hit.

## Native command-policy regressions

`coverage-zero-config-20261009-2` completed with all six logical actions
(`checkout`, `install`, `format`, `lint`, `test`, `build`) and 43 successful native
steps at source `baa325b060bed2d528640aaaf05c07b382e19bfa`. Native Workflow version
`50aa543a-8748-4704-802b-d97734458cc5` first read that revision's manifest, then used
the same `CI.fromPackageJson` inference as the local CLI. The consumer `ci.ts` stayed
empty. The host uses the default managed image with live workspace reuse disabled;
checkout and each action's workspace commit succeeded, and every command returned
exit zero. No deployment or release occurred. An independent named Node/Git-image
proof, `coverage-zero-config-20261009-3` (version
`4742ce3c-ad73-4df0-9fde-568e83ef8b1a`), also completed all 43 steps.

The superseded `coverage-zero-config-20261009-1` retains the Workers-specific
`redirect: "error"` failure. A regression now requires manual redirects and rejects
non-success responses without following them. Managed-image checkout took longer,
but eventually completed without intervention. No instance was restarted; histories
are preserved.

`coverage-source-checks-20261009-1` completed at source
`5d76f06b847d30f2cbbc74928741c514cfb5ee4e`: checkout, its checkpoint, and the source
file read are the only three native steps. The `format source` check succeeds with
zero container commands and no output checkpoint; Prettier executes in the Workflow
Worker. Adapter tests separately reject unformatted input and fail if either case
attempts to execute a container command. This is not a WorkerLoader/untrusted-module
proof, nor does it cover native retries for arbitrary Effect bodies.

The deployment-hook proofs use source
`74fb17499db6fe75b12376b5c409b60db3eaa143`. Both
`coverage-deploy-hook-deploy_hook-20261009-2` and
`coverage-deploy-hook-deployment-20261009-2` completed checkout, frozen `npm ci`,
real `cf build`, and credential-free `cf deploy --prebuilt --mode production --dry-run`
with live workspace reuse disabled (14 native steps each). No Worker was released.
`coverage-deploy-hook-pull_request-20261009-1` completed with the event condition
retained, deploy skipped, and zero native/container steps at source
`7da78080cbb5ad183e2ace73bf95d38d1a00d19d`. This verifies event routing,
not a public HTTP webhook receiver. The installed tooling pins Miniflare's transitive
`sharp` to patched 0.35.5; its isolated npm audit reports zero vulnerabilities.

`coverage-exported-actions-20261009-2` completed against source
`28b10e978463ca6db7dfa9cffdc95b1e7d82158e`: checkout and its checkpoint,
`node --check app/index.js` in the restored example workspace, and the check's final
checkpoint all succeeded (four native steps). Local CLI validation separately
confirmed that only `check` is listed and runnable; private `checkout` fails with
`CI_UNKNOWN_TARGET`. The hosted proof runs the default workflow, not a remote CLI
action-discovery endpoint.

These host-only probes never deploy resources or use secrets. They exercise the
adapter boundary separately from consumer examples:

| Instance | Result |
| --- | --- |
| `coverage-command-retry-20261008-1` | native command step fails twice, succeeds on attempt 3, then commits its workspace; source `deb4817d083b0ffda2a515d5fd8ca915bb8ce404` |
| `coverage-command-failure-20261008-2` | exactly one failed native attempt without an explicit retry policy; final Workflow error preserves exit 7 and stderr; source `bdaabeef68a3fd410abd0a542c5c91efa11ed837` |
| `coverage-optional-native-failure-20261008-4` | format's native step fails once but the consumer plan records a warning; lint passes and the Workflow completes; source `6aae009a4ed56a6aee746c16e2257c2bd1366d84` |

Command failures must throw inside `step.do`, not after a failed exit has been
recorded as a successful cached result. The adapter explicitly defaults command
retries to zero, matching local execution. Workflow error serialization loses custom
class identity, so the adapter restores its own command error code and diagnostics.

The optional example uses `CI.check`: a read-only assertion does not return a new
workspace or trigger a needless snapshot. Its runner uses `standard-1` consistently.
Superseded test instances remain in the native history; no instances were restarted.

## Native action-body policy

Policy-bearing actions now stage dependencies before a native `step.do` body. The
body's commands and final workspace snapshot run inside that boundary, rather than
creating nested command checkpoints. Reporting runs outside it; replay retains the
logical plan, command output, and serializable workspace revision. Pure Effects need
no container. Actions without explicit policies keep their granular checkpoints.

The native result adapter also reconstructs top-level `WorkspaceCheckpoint` and
`WorkspaceArtifact` results, including their workspace revisions and restore
capabilities. JSON round-trip/replay regressions cover cached results locally.
Hosted instance `coverage-artifact-policy-20261009-1` completed six native steps
using source `8a6721a255e668eb3d0d8d7c897f6edef5f1785e`, Worker deployment
`8a95b52f-d328-4809-a8f0-5485f230af08`, and Workflow version
`5092fa27-8472-478c-ae1d-c97300cdc9ee`. Policy-bearing publication returned an
artifact backed by snapshot `6f14a912-7090-4fda-a726-a1e05ec017a6`; the next native
action restored it and returned checkpoint `fbd57572-5e3c-48fa-932b-ac0de84a5fcc`.
The consuming check called `checkpoint.restore()` and printed
`artifact-policy-verified`. Both result kinds crossed real native serialization
boundaries without nested step checkpoints. This is not a general codec for
arbitrary class instances or resources nested in user data, nor an injected
artifact-publication failure test. The probe performs no deployment.

These live proofs used source `9a4c5e9a9cbf73625076884a0ab99ab458daf3b5` and Worker
deployment `1127e335-496c-427b-bcb4-4261811eeb3d`:

| Instance | Result |
| --- | --- |
| `coverage-effect-policy-20261009-1` | consumer `execution-policy` completes on native attempt 3 after two transient failures; one native step, no container |
| `coverage-effect-timeout-20261009-1` | expected failure: one attempt, per-attempt 5 ms timeout, no container |
| `coverage-effect-exhaustion-20261009-1` | expected failure: exactly three failed attempts for retry limit 2, no container |
| `coverage-effect-terminal-20261009-1` | expected failure: `NonRetryableError` stops after one attempt despite retry limit 10, no container |
| `coverage-action-command-retry-20261009-1` | command fails twice, succeeds on attempt 3, and publishes snapshot `68d1f246-74bf-481a-9979-280a72bd8916`; three native steps total including checkout and its commit |

The timeout adapter also interrupts the Effect fiber to prevent late successful
completion. Local regression tests cover native replay, original error identity,
reporting outside the boundary, late-dependency rejection, and retrying a body whose
final checkpoint fails. That regression alone is not a hosted recovery proof; the
controlled real-container proof is recorded below. Recovery without a retryable
body remains unverified.

## Native rollback policy

These proofs used source `de486d4a2367b9b2c88948b7cf234c1c06a8383a` and Worker
deployment `d381144b-4e70-4776-91ca-09b3ad9fb4fa`. The consumer workflow is unchanged;
the exhaustion host replaces only `echo deploy` with an exit-7 command.

| Instance | Verified result |
| --- | --- |
| `cf_daf5da36df28b3539cdb94423c4d3e8deb959f6a7be16573c50257586ef33da4` | success: checkout and its snapshot, then one successful deploy body with its snapshot; rollback skipped in the final plan |
| `cf_05fed395817cce251ce9c264bdd472a0e32426982acc9b222953553942e0b6bf` | expected failure: three exit-7 native deploy attempts, then exactly one successful rollback command and its snapshot; final error retains exit 7 and stderr |
| `coverage-reverse-rollback-20261009-1` | expected failure: two completed reversible actions, two failed health attempts, then rollback second followed by rollback first; final error remains the health regression |

These are adapter-policy proofs, not real deployments. The reverse-order probe uses
pure Effect bodies and no container. The two malformed `coverage-rollback-*-20261009-1`
instances were terminated without deleting or restarting their histories. The CLI
generated opaque IDs for the corrected runs because their body used `id` rather than
`instance_id`; the returned IDs above are the authoritative evidence references.
The current failure-only host selects the existing Node/Git image for future probes.

## Cache and checkpoint correctness

Cache input fingerprinting is now verified: `coverage-cache-inputs-cold-20261009-2`
missed, `coverage-cache-inputs-warm-20261009-1` hit at source
`b7c510ed661c1c221072849ba1b1dd93308e702a`, and
`coverage-cache-inputs-changed-20261009-1` missed after changing its declared input
at source `e8a0af66921525c4ca6b8957e98d881c75dcdf89`. All three verified the output.
The identity includes key-file contents, repository, owned paths, and container
configuration; Vite+/Turbo additionally validate their own task inputs.

Snapshot resource-limit failures also occurred in
the superseded optional-check runs. After the live container stopped, retrying only
the snapshot could not recover its uncommitted files. Removing needless check
snapshots fixes this example, not the general checkpoint-failure recovery problem.

`coverage-checkpoint-recovery-20261009-1` completed four native steps at source
`4aabe232beb60e21a8c7a20832eccf7e1e29adc2`, Worker deployment
`ff5f62e7-712c-45f7-a417-c076558227fc`, and native Workflow version
`bdacaafb-0bef-4530-9335-bd3f29b96498`. The host-only persistence layer replaced the
first attempt's live container with its input snapshot, discarding the computed
files, and then threw `expected-checkpoint-failure-after-container-replacement`.
The policy-bearing body retried once, rebuilt `attempt-2`, and published snapshot
`cbf0b0db-d1f1-4cfa-b45e-48717d4c1cae`. A separate check restored that revision and
returned `recovery-verified`. Its plan retains only the two successful-attempt body
commands, not duplicate entries from the failed attempt. This proof uses `standard-1`
consistently for startup and restoration; no release or external write occurred.

This verifies controlled filesystem loss with an explicit retryable body—not arbitrary
snapshot-provider outages or reconstruction from already-cached granular commands.
Bodies that mutate external services must still be idempotent or use deduplication;
recomputation can repeat those side effects. Neither the workspace snapshot nor the
native checkpoint is a transaction across external systems.

Multiple commands in one action now have independent native checkpoints, named from
the logical action ID and command position. Positions include commands reused by the
check-cache layer, so evidence reuse cannot accidentally renumber later operations.
The commands still share the action's working filesystem and publish one final revision.
Deterministic replay restores each result independently, including repeated commands.

`coverage-command-sequence-20261008-1` verified this in the deployed Workflow at source
`7900483beba7180aa09fee4970a054e3bb9b5f4d`: two distinct native command checkpoints,
the second reporting `sequence-verified` after reading the first command's file, followed
by one action workspace commit. The run completed with five native steps. Existing
instances retain their pinned Workflow version; checkpoint naming changes apply to new
instances rather than migrating old histories.

## Private R2 source

`coverage-r2-source-20261010-1` completed using Worker deployment
`f81462ad-8d98-448c-95de-4e22aef1d632` and Workflow version
`eec420bc-6ddf-4650-8edf-2e090e16ddb2`. The private `SOURCE_BUCKET` binding read a
97-byte source manifest, verified SHA-256
`6759fef7f59ccbd363fb8c42062fb4903d98070d08da56c6ae873d9a75ea41cd`, materialized
regular files, and committed snapshot `d309cecf-6d9c-4461-a3a3-8bb8eb7fbbbd`.
A separate downstream native read restored that checkpoint and returned
`source from r2`. No R2 or API credentials entered the container. The focused
[R2 example](../../examples/r2-source) documents the manifest and repeatable commands.
