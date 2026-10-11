# Closed native Workflow outcomes

`reconcileWorkflowTelemetry` consumes native `events.workflows` rows and a trusted
manifest recorded independently through authenticated native instance metadata.
It counts each expected logical instance once, not every step retry, wait resume,
or Durable Object reset. Only `WORKFLOW_SUCCESS` and `WORKFLOW_FAILURE` matched to
the final status and ending second are terminal outcomes. Known START/RUNNING
updates are ignored; unknown, conflicting, weighted, missing or saturated results
cannot close the cohort. An instance ID supplies the logical execution identity;
the adapter does not invent a platform log-record UUID.

SQL has no version column for this dataset. The manifest must bind each instance
to its independently recorded **Workflow version ID**. That is not a Worker script
version ID, and must not be silently substituted into a Worker rollout comparison.
The caller owns authentication, immutability, query scoping and closure of the
expected logical cohort. Expected identities must come from trusted admissions
recorded before outcomes, not a query selecting only successful/completed jobs.
Pending executions or a window with no admitted executions cannot produce this
closed-terminal manifest; the caller must retain insufficient-data uncertainty,
not drop pending identities or manufacture a zero-error sample.
Query time is not an ingestion watermark; coverage of
these known instances is not completeness of ambient production executions.
Missing daily-cron outcomes remain incomplete rather than zero-error health.

Read-only real API proof on 2026-10-11 used two known HMD demo instances:
`coverage-hmd-sampling-deadline-20261011-1` (complete) and
`coverage-hmd-sampling-regression-20261011-1` (errored). Both native instance
metadata records pinned Workflow version `e6569f37-6512-4957-9ecd-da7113460c8e`.
A bounded SQL window returned 30 weight-one native rows: 28 lifecycle updates,
one terminal success and one terminal failure. The adapter reconciled **two
logical trials and one failure** against both independent metadata snapshots.
These are controlled controller outcomes, not application release-health evidence,
an A/B comparison, a hosted binding integration, or a confidence/SLO verdict.

```sh
HMD_CF_BIN=/path/to/cf \
WORKFLOW_TELEMETRY_ACCOUNT=YOUR_ACCOUNT_ID \
WORKFLOW_TELEMETRY_INSTANCES=coverage-hmd-sampling-deadline-20261011-1,coverage-hmd-sampling-regression-20261011-1 \
node --test packages/cloudflare/src/live-workflow-telemetry.test.ts
```

The test reads authenticated instance metadata and queries a bounded, parameterized
SQL window through the local `cf` session. It never starts runs, sends events,
deploys, posts notifications or copies personal credentials to a Worker/container.
The [SQL binding documentation](https://developers.cloudflare.com/analytics/sql-api/workers-binding/)
still excludes Log Explorer-backed datasets; this Workflow event adapter does not
make the existing Workers-log diagnostic adapter a supported production binding.
