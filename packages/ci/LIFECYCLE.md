# Lifecycle observations

Baseline: landed `20f2910` on `main`. The lifecycle implementation in this branch
is unlanded. It extends existing runtime events, approvals, compensation, and
the maintained RunCard; it does not replace them with a scheduler or journal.

Process guidance: [observational delivery](./OBSERVERS.md), last changed October
18, 2026, and [notification delivery](../github-cloudflare/NOTIFICATIONS.md).
Required callbacks remain authoritative. Optional failures remain quarantined;
they never authorize a decision or retry a business action. Current prior art is
`makeRuntime`, `withStepPolicy`, `RunCard.update` and the host's serialized
`notify` function. No process/prior-art conflict was found.

## Events and timing

[Lifecycle types, transition graph and projection](./src/lifecycle.ts "source")

[Adapter-owned wait scope](./src/index.ts#symbol=withLifecycle "source")

`step.lifecycle` separates dependency wait, available compute, executor startup,
execution, retry backoff, evidence collection and an authorized decision wait.
Only dependency resolution, local retry policy, leaf execution, evidence scopes
and configured approval requests automatically emit these phases. Native
admission/startup/backoff is not inferred from a native queued/running status.
Adapters can wrap a real boundary with `withLifecycle`; no hosted adapter gains
new admission or startup observability merely by importing these types.

Retry deadlines are the local policy's scheduled wakeup, not an execution SLA.
Approvals have no deadline field in the current `ApprovalRequest` contract, so
none is invented. Existing approval URLs/buttons remain the only decision
actions; a lifecycle event never creates an approval capability.

Each closed interval is attributed to the phase that began it. Queue, startup,
execution, dependency, retry, decision and evidence measures are separate and
expressed in milliseconds. An unobserved or still-open interval remains `null`;
only an observed zero-length interval is zero. These are per-step wall-clock
intervals, not CPU, cost or an additive workflow duration across parallel steps.

The projection rejects invalid timestamps, older step transitions, repeated
phases, illegal transitions, and updates after terminal outcome. Terminal success,
business failure, cancellation, rollback requested, rollback completed and
rollback failure have distinct labels. Terminal controls are cleared and
unfinished legacy checks become skipped. Completion after compensation remains
business failure, never release success. Interruption does not start new failure
compensation; terminal reporting runs under an interruption mask after work exits.

Legacy status events retain compatibility with existing synthetic timestamp
fixtures. Valid timestamped status and decision updates have a per-step watermark;
terminal lifecycle outcomes cannot be reopened by legacy events.

## Full call diff

Unmarked calls retain baseline behavior. `+` is implemented in this branch;
`-` is behavior moved or replaced from the landed baseline. No proposed API is
presented as landed.

```diff
 interpret(workflow: Workflow<A>, mode, options: RunOptions)
   makeEventEmitter(onEvent?, observers?) -> writeEvent -> required onEvent -> optional observers.publish
   makeRuntime(...) -> runtime
   workflow.effect -> runStep(definition, dependencies)
     runtime.addDependency(parent, child)
+    runtime.lifecycle(parent, "dependencies") -> step.lifecycle
     Cache.get(runtime.cache, child)
+    runtime.lifecycle(parent, "executing") -> step.lifecycle
     definition.prepare -> prerequisite actions -> leaf
     actionExecutor.execute({ stepId, options, run(attempt) }) when native policy owns work
       buffered body events -> emitOutsideBody after successful checkpoint
-    withStepPolicy(leaf, options) when local policy owns work
+    withStepPolicy(leaf, options, lifecycle?) when local policy owns work
+      lifecycle("executing") -> leaf
+      on retryable failure -> lifecycle("retry-backoff", scheduledDeadline) -> existing retry schedule
     leaf -> commandExecutor.execute(request) -> original diagnostics/output/status
+      withLifecycle(phase, effect, deadline?) -> runtime.lifecycle -> effect -> runtime.lifecycle("executing")
     runtime.requestApproval(stepId, request)
+      lifecycle("awaiting-decision")
       approval.requested -> required approvalHandler.request -> approval.resolved
+      lifecycle("executing") -> original approval/rejection enforcement
+    leaf exit -> lifecycle(succeeded | reused | failed | skipped | cancelled)
     step.status -> original plan/output/checkpoint handling
   on business failure -> runtime.unwind(original)
+    workflow.lifecycle(rollback-requested) when compensation exists
     registerRollback -> rollback.effect -> collect compensation failures
+    workflow.lifecycle(rollback-completed | rollback-failed)
-  interruption can end the interpreter before terminal reporting
+  restore(workflow.effect) under uninterruptibleMask -> Exit -> terminal reporting
+  workflow.lifecycle(success | failure | cancelled) unless compensation already reported outcome
   workflow.plan -> workflow.completed -> required onAttempt -> preserve original result/cause
   CLI local onEvent -> configured required callback
+    formatLifecycle(event) -> text stream only (JSON remains machine-readable)
   host onEvent -> reporter.report -> serialized notify(key, card.update)
+    lifecycle event keys -> same acknowledged root message, no new lifecycle thread replies
+    defer success lifecycle presentation when existing required finalization owns success
   RunCard.update(event)
+    LifecycleProjection.update -> valid transition? -> interval totals -> snapshot/render
+    reject stale status/decision updates -> preserve terminal state -> clear controls
   notificationLayer -> existing optional destination bounds/quarantine
```

## Identity dependency and evidence limits

[#168](https://github.com/ericclemmons/effect-ci-testbed/issues/168) owns
`RunIdentity`, `EventCorrelation`, sequence/event identity, execution attempts and
`CorrelationCursor`. This branch deliberately adds none of those contracts.
The inspected in-progress implementation attaches correlation in the central
emitter and gates RunCard through its cursor. Integration must preserve the
intersection of correlation with **every** RuntimeEvent variant, including the
two lifecycle variants, and reset lifecycle state only after the cursor admits
a newer workflow attempt. Timestamp guards alone do not establish cross-attempt
ordering or distinguish equal-timestamp retries. Do not close #169 before this
integration and its real retry/rerun evidence are verified together.

The local walkthrough is not a hosted CLI/Slack campaign. Native policy-bearing
bodies currently buffer events until a successful checkpoint, so this branch
does not claim live native retries or in-flight telemetry visibility. Hosted
adapter evidence and actual maintained Slack delivery still need an authorized
existing target. No new resource, permission, spend, notification, journal (#170),
or human decision is authorized by these observations.
