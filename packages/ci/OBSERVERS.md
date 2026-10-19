# Observational runtime delivery

Use `onEvent` / `onAttempt` for **required** reporting or state persistence.
Their failure remains authoritative. Use `makeRuntimeObservers` only for optional
presentation delivery:

```ts
const observers = CI.makeRuntimeObservers([
  { id: "dashboard", deliver: (event, signal) => updateKnownDashboard(event, signal) },
  { id: "activity", deliver: (event, signal) => updateKnownActivity(event, signal) },
]);

try {
  await CI.runPromise(workflow, {
    observers,
    onEvent: persistRequiredEvent,
    onAttempt: persistRequiredAttempt,
  });
} finally {
  // Required persistence stays outside the optional-delivery boundary.
  await persistDeliveryDiagnostics(observers.snapshot());
}
```

These are trusted host callbacks, not project/event-supplied destinations. Nothing
is enabled by default. The runtime calls required event reporting first, then
fans out independently to optional destinations. Each destination is serialized;
one throw, rejection or timeout does not cancel another or alter business retries,
rollback, success or the original business failure.

Each delivery has a 20-second default deadline (host-configurable from 1–20,000 ms)
and receives an abort signal. Failure or uncertain acknowledgement quarantines
that destination for the rest of the session: later events record `blocked`,
without calling it again. A deadline is not proof the remote side did nothing;
callbacks must honor abort, and uncertain external POSTs need independent
same-message reconciliation before any new delivery session. Never create a new
session merely to bypass quarantine. There is no automatic retry or reconciliation.

At most eight unique named destinations and 256 event deliveries per destination
are admitted. The last 256 redacted receipts are retained with explicit
`omittedReceipts` and `droppedEvents` counts. No eviction restores delivery budget.
Receipts contain sequence, destination ID, event type and delivery classification;
they never copy exception messages, tokens, URLs, command output or source.
The immutable observation itself contains only type/workflow/timestamp and optional
step/status/conclusion, not mutable plans, outputs, actor identities or review
capabilities. This in-memory session is **not a durable event journal** (#170).

Do not place persistence, check enforcement, lease acquisition, approval validation
or deployment mutation in these callbacks. Failed/missing review presentation
never means approval: keep the configured required wait/deadline/recovery policy.
Trusted synchronous CPU-blocking code cannot be preempted by a JavaScript timer;
this API is not an execution sandbox. It bounds asynchronous delivery, not arbitrary
untrusted JavaScript. A callback ignoring abort can continue externally after the
runtime stops waiting; that is another reason not to retry an uncertain write.

The generic callbacks are tested locally for success/failure, real business retry
and rollback behavior, rejected/unavailable approval, required persistence failures,
independent providers, redaction, quarantine and storage/delivery bounds. The
[standalone owned fixture](../../test/apps/notification-isolation) adds real local
Workflow/SQLite/RPC cases. Its earlier native provider campaign remains distinct
from any new observer campaign; local tests do not relabel historical deployments.
