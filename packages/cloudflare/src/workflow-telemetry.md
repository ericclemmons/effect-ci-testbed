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

## Admitted application windows

The admitted-window adapter is separate from the historical closed-terminal
adapter. It retains identities with no terminal metadata, including planned cron
slots. A trusted producer records account, Workflow name and version, a unique
window ID, unique logical IDs, reserved native instance IDs for direct dispatch,
admission time, scheduled time,
and completion deadline **before** the execution window opens. The producer must
reserve these identities independently of outcomes. A frozen JavaScript object is
not proof of admission: retain the original authenticated admission-record creation
payload and its platform timestamp. A separate `admissionId` identifies that native
record. Its payload digest and creation time must match the window before the
controller accepts evidence. Do not reconstruct admissions from SQL.

Native cron assigns an instance ID at dispatch, so a planned cron slot may omit
`instanceId`. Its identity is the pinned cron expression and scheduled time. The
independent native discovery port, never SQL, joins that slot to an instance ID.
Two native instances for one slot conflict. Missing, truncated or unavailable
discovery cannot close the window. Unknown IDs are not fabricated in advance.

[Window contract and sealing](./workflow-window.ts#symbol=WorkflowWindow "source")

[Canonical admission digest](./workflow-window.ts#symbol=workflowWindowDigest "source")

[Admitted outcome reconciliation](./workflow-window.ts#symbol=reconcileWorkflowWindow "source")

Each instance stays one logical invocation through native step retries and
in-progress restarts. Identical terminal deliveries count once. A terminal row
must match independently read native version, final status and ending second.
Earlier contradictory terminals are **not** discarded as assumed resets: a reset
after an already terminal execution remains uncertain in this adapter. Unknown
events, weighted rows (including lifecycle rows), foreign identities, duplicate
metadata, version conflicts and a saturated query all prevent a closed sample.
Every final metadata read must also occur after the window closes; a later SQL
query cannot turn a pre-closure metadata snapshot into proof of final state.

Availability is separate from terminal error rate. A trustworthy native snapshot
read after an admitted deadline can establish that an execution did not finish
on time. Missing metadata or a failed metadata read is unknown, not a proved
miss. A late terminal can count as one terminal outcome while also missing its
deadline. A failed execution that finishes on time still meets its completion
deadline; it remains a terminal failure. No deadline miss is added to the error
count. Missing native admissions past their deadline are listed separately as
`overdueUnknown`, not proved terminal failures or silently dropped slots. A
zero-admission window and a sparse daily cron cannot establish health.

Only the producer enumerates expected cron slots and pins the cron expression.
This adapter neither installs a schedule nor guesses invocations from observed
rows. Cron metadata must independently match the native `cron` trigger, exact
expression and scheduled time. A manually dispatched Workflow cannot become cron
health by changing a manifest label. Retain the schedule and native trigger receipt
for hosted proof.

## Controller and notification consumption

[Native source ports](./workflow-health-source.ts#symbol=nativeWorkflowHealthSource "source")

[Bounded controller](./workflow-health-controller.ts#symbol=runWorkflowHealthController "source")

The source reads every admitted instance independently, then queries the same
account, Workflow and IDs in a parameterized, bounded `events.workflows` window.
Native checkpoint snapshots are capped at 512 KiB. Its metadata port must return
the actual native Workflow version; it must not copy a Worker deployment version
or fill a missing version from the requested manifest.

The controller pins both windows and policy, reads at most three observations,
waits 30 seconds between inconclusive observations, and calls `evaluateHealth`
only with reconciled logical samples. A failed source is unavailable/uncertain.
An incomplete, weighted, conflicting or sparse sample cannot advance. Two windows
cannot advance when either window's completion deadlines are not met; those misses
remain separate from the terminal error count. Two windows
of the same Workflow version remain uncertain rather than becoming a fictitious
release comparison. This observer does not claim, promote or restore a Worker
release; no Workflow-to-Worker version mapping is implied.

[Existing native host integration](../../../test/apps/example-runner/src/hmd-review-controller.ts#symbol=HumanReviewedHmdWorkflow "source")

[Semantic notification adapter](../../github-cloudflare/src/workflow-health.ts#symbol=sendWorkflowHealthNotification "source")

The opt-in native controller consumes authenticated API-delivered snapshot events
and invokes the semantic notification adapter. It verifies each window against
its separate original admission record, created before that window opens. This
permits a previous-version window to predate the observer itself. The native API
provides the event authentication boundary; no public callback endpoint is added.
This is an explicit operator-fed native collector path, **not** proof that Analytics
SQL works through a deployed binding. The source-port adapter supports a native
reader when that reader's feasibility is independently established in #138.
The supplied CLI collector reads reserved IDs only. It intentionally leaves
automatic cron-ID discovery unavailable; it does not invent IDs or replace that
missing provider with a terminal-only list.

Notifications update only explicitly owned existing Slack bot/Discord messages;
they never create a message or use a Slack webhook fallback. No configured channel
or no owned message means notification unavailable. Each observation records
delivery separately from health. Delivery is not retried after an ambiguous ACK;
it never becomes a failed application invocation. No GitHub view is added here;
#140 consumes the structured observation and owns that presentation.

## Verification boundary

The admitted adapter, native controller branch, notification adapter and fixture
are implementation, not a retained hosted campaign. No new resources, credentials,
cron schedules, release changes or notification messages are authorized by these
modules. Hosted good/bad/reset receipts and a real controller/notification run are
still required before #139 can close. The older read-only SQL proof below does
not satisfy those requirements.

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
