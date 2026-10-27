# Run and step correlation

Baseline: main `20f2910`. The existing retry policies, native attempt counters,
immutable workflow attempts, and adapter-validated snapshot reuse remain owners
of execution and provenance. Correlation does not grant reuse or replay authority.

[Public identity types](./src/correlation.ts#symbol=RunIdentity "source")

[Execution attempt](./src/correlation.ts#symbol=ExecutionAttempt "source")

[Runtime entrypoint](./src/index.ts#symbol=RunOptions "source")

| Identity | Scope and parent | Uniqueness |
| --- | --- | --- |
| Repository/commit | Git source selected by the adapter, not event path hints | Exact repository string and immutable revision; absent for sources without Git identity |
| Definition | Workflow name within that repository/revision | `definitionId` plus source; not a function-content digest |
| Logical run | An invocation and its explicitly requested reruns | UUID locally; host-supplied stable ID on native backends |
| Workflow attempt | One execution of that logical run's definition | `workflowAttemptId`, one-based number, prior attempt link |
| Logical step | Declared step name within the logical run/definition | Parent logical run plus step ID; placement is not part of it |
| Execution attempt | Existing policy interpreter's invocation of a step body | Tuple of workflow attempt, step ID, and one-based native/local attempt number |
| Backend handle | Detail attached to the run or execution attempt | Provider and native instance/step handle; step handles are relative to the parent instance |

An invocation starts a fresh logical run. A rerun retains that run, creates a new
workflow attempt, and links its predecessor. A retry changes only the execution
attempt. Native checkpoint replay retains the same host-supplied IDs and counters;
it does not create another logical run. Trusted native adapters can label an
explicit resume with the same run/attempt IDs and number. This option is rejected
without native policy interpreters; it is not a local resume engine. Moving an
executor does not change identity when the host retains its correlation context.

The two Cloudflare entrypoints derive stable run/attempt IDs from the native
instance, rather than generating replay-local UUIDs. Reruns inherit the logical
run from their retained predecessor. The showcase's private retained record keeps
this identity and output origins alongside its existing source/version checks.
Legacy records remain readable: their prior record ID becomes the root, but
missing execution history is never manufactured.

## Events and public views

Every emitted event carries a run identity and increasing delivery sequence.
Step events also carry the logical step and, after body entry, its execution
attempt. Reused outputs carry their original producer, across repeated reruns.
Sequence numbers order one interpreter pass; they are not durable journal offsets.

The cursor rejects another logical run, older workflow attempts, competing IDs
at the same attempt number, older execution attempts, duplicate/out-of-order
updates to a target, stale plan snapshots, and updates after terminal completion.
Different steps can still arrive out of order. Legacy events work only until a
correlated stream starts. GitHub and RunCard apply this guard before mutating
their views. GitHub writes are serialized so a slower earlier request cannot
finish after a newer update. A provider reporter/card is owned by its host run; a fresh host run
must construct a fresh reporter/card and provider handles.

[Stale-update guard](./src/correlation.ts#symbol=CorrelationCursor "source")

GitHub step details and notification cards display readable workflow/step names,
logical run and attempt numbers. CLI JSON includes public attempt details, not
arbitrary outputs or snapshot capabilities. Text includes execution outcomes and
producer links. Native counters prove earlier policy attempts occurred, but after
replay their exact errors may be unavailable: `retried` is not a fabricated error
or timestamp. Native action receipts retain the observed execution records with
their command/output checkpoint; terminal failures may have less detail after
isolate loss. Command-level native retry history remains in the native command
receipt, not a claimed whole-action re-execution.

Public IDs and output origins are correlation, not signed evidence. Existing
source/runtime/snapshot validation still decides reuse. Result-cache providers
that do not supply producer identity remain unknown: their origin is marked
`retained`, not `executed`, and links the retaining attempt rather than a fictitious
producer. Legacy rerun records use that same distinction. No observations rerun commands, republish snapshots, issue
approvals, or repeat external side effects to repair presentation. Required
observer/receipt failure still fails the run; optional observers remain isolated.

## Call diff

This is the full change from landed `20f2910`, not a new retry API:

```diff
 Cloudflare.workflowEntrypoint(...).run(event, step)
 GitHubCloudflare.workflowEntrypoint(...).run(event, step)
+  CI.run(definition, { correlation: stableInstanceIdentity, ... })
 CI.run(definition, options)
+  resolveIdentity(source, previousAttempt, hostCorrelation)
   makeRuntime(...)
     planRerun(previous.plan, steps)
     reuse previous outputs without execution
+    keep outputOrigins[step] at the original producer
     withStepPolicy(body, options) / ActionExecutor.execute({ run(attempt, backend?) })
+      observeExecution(body, nativeOrLocalCounter, backendHandle)
       commit Workspace using existing persistence (local: outside retry policy)
+      native action receipt retains executions alongside events/value
     unwind(originalFailure) using existing rollback ownership
   onEvent(event) / onAttempt(attempt)
+    include identity, execution attempts, producer links
   GitHub.Reporter.report(event) / RunCard.update(event)
+    CorrelationCursor.accept(event) before updating views
   required callback failure remains a run failure
```

Nothing moves into a replacement execution engine. #169 owns richer lifecycle and
wait reasons; #170 owns durable event sequencing, journal replay and independent
provider delivery cursors; #171 owns DAG scheduling and concurrency. This cursor
does not claim journal recovery or exactly-once provider delivery. The existing
native resource cleanup and snapshot validation paths stay unchanged.

## Evidence

[Combined owned recipe](../../examples/run-identities)

Local proof is not target-environment proof. No new hosted run, resource,
permission, notification, or budget is authorized by this change. Keep #168 open
until the approved hosted combined journey and intentional delivery are retained.
