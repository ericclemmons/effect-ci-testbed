# Strict native health: contract and evidence

Reviewed October 26, 2026 against main
`20f29103911800606929de4f9afa095667606e48` for
[#138](https://github.com/ericclemmons/effect-ci-testbed/issues/138).
This is a read-only reconciliation, not a new hosted campaign.

**Outcome: blocked on a supported native telemetry source and a retained strict
four-phase success.** The controller already exists. Do not rebuild it, weaken
uncertainty, or describe all successful progression as timer-driven. Leave #138
open: this report does not satisfy its strict native success criterion.

## Existing implementation

The native controller landed in
[PR #92](https://github.com/ericclemmons/effect-ci-testbed/pull/92), commit
`6a6d901`; later integration moved the host to `test/apps` in
[PR #372](https://github.com/ericclemmons/effect-ci-testbed/pull/372).
These are landed capabilities, not APIs proposed by this report:

- Independent edge receipts bind each expected request to a Worker version.
- Each cohort and request window freezes before SQL reads. Six bounded ingestion
  reads reuse that cohort; lost receipts are not replaced with fresh traffic.
- Every 10/25/75/100 phase, including 100%, requires a strict `advance` decision.
  Regression is nonretryable; incomplete cohorts and exhausted uncertainty fail.
- The broker owns exact-allocation rollback, leases, drift checks and an independent
  recovery alarm. Successful labs also restore their baseline and do not commit a release.

[Native controller](./src/wobs-healthy.ts#symbol=WobsHealthyWorkflow "source")

[Receipt reconciliation](./src/wobs-samples.ts#symbol=readReceiptSamples "source")

[Experimental source boundary](./src/hmd-native-source.ts "source")

### Call diff

Baseline and end state: main `20f2910`. This documentation-only change adds no
runtime API, moves no behavior and changes no calls. All lines below are unchanged;
the tree summarizes control flow rather than providing executable code.

```diff
 WobsHealthyWorkflow.run(event, step)                         [trusted controller]
   broker.begin(owner, candidate)                           [host-only service binding]
   nativeCohort(key, count, versions)                        [baseline, then each phase]
     broker.renew(owner)
     collectReceipts(count, versions)                       [independent identities]
     step.sleep(..., "1 second"); freeze(batch, from, to)   [window closes once]
     readReceiptSamples(batch, versions, from, to, query)    [same cohort, <= 6 reads]
       query(input) -> env.ANALYTICS_SQL.query(input)        [injected callback]
       sqlFetchOutcome(raw) -> reconcileTelemetry(manifest, rows)
       saturated/unknown/weighted/conflicting/missing -> no complete sample
       query error -> bounded retry only if retryable === true; otherwise nonretryable
   for phase in [10, 25, 75, 100]
     broker.promote(owner, phase); verify exact allocation
     nativeCohort(...) -> combineSamples(...) -> evaluateHealth(previous, candidate, policy)
     uncertain -> bounded wait/new independent cohort only after the prior cohort closed
     advance -> next phase; regression -> NonRetryableError
   broker.rollback(owner) -> verifyHealthyLab(...)           [successful lab cleanup]
   catch -> broker.rollback(owner); throw                   [failed lab cleanup]
 ReleaseJournalObject.alarm() -> manager.recoverExpired()    [independent recovery]
   recovery failure -> reschedule alarm; retain reconciliation intent
```

`freeze` describes checkpointed values, not a new function. The controller's outer
catch covers the baseline/phase work after its initial claim. Broker recovery is
separate from controller cleanup; this report does not broaden that catch or claim
that every possible failure passes through it.

## Documented contract versus observed behavior

Cloudflare owns the platform contract. Its [Workers binding documentation](https://developers.cloudflare.com/analytics/sql-api/workers-binding/)
and [dataset documentation](https://developers.cloudflare.com/analytics/sql-api/datasets/)
both show an October 2, 2026 update date. Read them together: dataset availability
through the SQL API is not the same as support through the Worker binding.

| Contract | Current adapter | Finding |
| --- | --- | --- |
| `analytics.binding`; `query({ query, params })`; account scope supplied by the Worker | Uses `ANALYTICS_SQL.query`, named parameters and SQL time bounds without tenancy predicates | Matches the request contract; no token, `scope`, `time_range` or `FORMAT` workaround is needed. |
| Binding returns the default ClickHouse-backed `data`, `rows`, `statistics` structure | Reads `data` as individual native rows | Matching a response shape in one account does not establish dataset support or completeness. |
| Log Explorer-backed datasets have a different response shape and are not supported through the binding | Queries `logs.workersLogs` and observed `$workers.*` attributes | Historical account success is experimental. The dataset catalog's Workers Logs example is not a binding-support guarantee for this native path. |
| Logs can be sampled; weighted aggregates cannot reconstruct unretained individual events | Accepts only exact native identities with `sampleInterval === 1` | Preserve this rule. Do not substitute `COUNT`, weighted totals or HTTP success for missing native outcomes. |
| Retry only when a thrown error has `retryable: true` | Explicit check plus bounded exponential backoff | Preserve native retry and nonretryable failure behavior. |

The reviewed sources do not establish a binding-supported native per-request
replacement with the adapter's version, request identity, terminal outcome and
sampling fields, or an ingestion barrier for its frozen window. This is a concrete
contract gap, not proof that Cloudflare can never expose such a source. Discovering
a dataset in one account would still not prove binding support or cohort closure.

Full coverage of a known, closed cohort can establish that cohort's completeness.
Neither a query timestamp nor a settling sleep is a general ingestion watermark.
Head sampling set to 1 does not repair already sampled or missing outcomes.
Changing the transport to the HTTP SQL API or the observability API would require
a separately verified adapter and authorization; neither is implemented here.

## Exact evidence and its limits

The October 10 native runs below are historical records in the [host guide](./README.md#native-healthy-controller-fail-closed-evidence),
not newly retrieved raw histories. Their read-only assertions exist, but an
assertion's source is not a passing run result.

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Native strict attempt `cf_e3e11b3f1e107ce642cd6d96b1c18b7bf4231788d2696bcad16a00ef6ea89e6e` | Recorded failure at 10%: 4,935 stored rows, 71 missing expected outcomes and six rejected rows after six reads; no 25% promotion. Recorded rollback deployment `177449ea-0692-4b7d-97ff-c595d1c8c432` restored the prior baseline at 100%. | No strict native four-phase success. These counts are historical, not a fresh platform measurement. |
| Fixed-window diagnostic `cf_1d8a63fb13e9d8c44bb88d355dc4f63cce29736160caf1383e29f04ec2ef1217` | Recorded 4,929 weight-1 rows and six weight-10 rows. The failed cohort remained failed. | Multiplying six sampled rows by ten cannot create independent healthy trials. |
| Paced prerequisite `cf_0bba4149365e4ba8784676124bcdf7613551d0b457487ed5e8d4f91281e260c4` | Recorded closure of 5,000 weight-1 outcomes after an ingestion wait; host `f50fd003-5d90-4516-8ac0-a3a6c0baabe5`, Workflow version `45b65b38-7fed-4881-a5b9-9073f7bec334`. | No four-phase campaign, universal sampling threshold or supported binding contract. |
| [Retained October 24 release journey](../../../examples/release-flywheel/proof/cf_79311e782345e200e1cda85a4b2eb3719ec810403666f9101c2db82a005f5bfc.json) | Real healthy 10/25/75/100 HTTP-cohort gates, including the final check and exact restoration. | Explicitly `evidenceSource: closed-client-http-cohort`, `wobsVerified: false`, `releaseCommitted: false`; not native telemetry proof. |

The retained journey pins source revision
`724c4f73a48f98faa246e92a3b15c160c65eb3c0`, Workflow version
`7f0f4c64-a07b-4c39-a814-8d7d68003355` and candidate
`041850ee-aaa0-4a8a-8f39-dd24f4054011`. Each phase first remained uncertain,
waited, then passed health bounds with more observations. This is health-driven
progression, not deadline risk acceptance. Its separate approval receipt records
`agent-on-user-delegation`; approval is not the source of the health decisions.
Cleanup deployment `cf23b4e7-3859-441f-8ff5-fcc48e841f06` and the
[independent restoration receipt](../../../examples/release-flywheel/proof/restoration.json)
restore baseline `156c4427-b574-49e8-a6c9-cf2d034131b3` at 100%.

On October 26, the existing negative-run and diagnostic assertions were attempted
with those exact native instance IDs. Both stopped at `No authentication token
found` before reading history. The positive assertion was skipped because no
strict native success instance was supplied. No claim of fresh native verification
is made, and no login, permission change, traffic, deployment or replay was attempted.

Local validation passed 44 existing health, cohort, budget, ingestion, cleanup and
recipe-documentation checks. The separate `hmd-native-source.test.ts` file could
not load because workspace dependencies are not installed (`@effect-ci-testbed/ci`
was missing); it is not a passing check. No tests were changed. The full docs build
was not run without workspace dependencies.

## Smallest honest next outcome

Keep the experimental opt-in adapter and all fail-closed policies unchanged.
Before authorizing another campaign, obtain a supported native source contract
for the required fields and re-read the existing frozen histories through an
already authorized session. If schema discovery is needed, the documented SQL
introspection route requires Account Analytics Read; do not grant it automatically.
No new target or wider rollout budget is justified by this report.

A future strict success must retain the exact source/host/Workflow identities,
all frozen cohort reads and windows, zero missing/conflicting/unknown/weighted
evidence, unsaturated results, strict passing bounds at all four allocations and
the restoration/recovery receipts. Failure to close any cohort remains uncertainty,
not permission to replace it or accept risk as health.

Logical Workflow/cron outcomes ([#139](https://github.com/ericclemmons/effect-ci-testbed/issues/139))
and presentation views ([#140](https://github.com/ericclemmons/effect-ci-testbed/issues/140))
are separate work; neither supplies this missing native contract or success receipt.
