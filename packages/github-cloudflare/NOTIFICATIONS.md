# Optional provider delivery

Construct `notificationLayer` once per run and serialize semantic publish calls.
Each registered destination receives the frozen credential-free run snapshot,
not command output, review capabilities or private summaries. A successful
receipt contains external message identifiers only and is reused on later edits.

Asynchronous provider delivery and its checkpoint are bounded to 20 seconds.
The optional constructor `timeoutMs` can shorten, not raise, that bound. The
Cloudflare host also configures every provider checkpoint for zero retries and
a 20-second timeout. It does not rely solely on an in-memory timer.

Rejection, synchronous throw, Effect defect, timeout or checkpoint error returns
only `{ provider, status: "failed" }`, without upstream exception/credential text.
That destination is quarantined for the rest of the run. Replaying its failed
checkpoint reconstructs the quarantine; a later event cannot blindly POST again.
The last acknowledged receipt is retained, but there is no reset/resume API.
Inspect and reconcile an uncertain external acknowledgement independently.
Other destinations still receive later snapshots and their original receipts.

This is observational delivery, not approval or business authority. Required
state persistence, GitHub verification/reporting, review validation, the review
wait/deadline and release-manager mutations are unchanged. A missing notification
is never an approval. Required host review publication still fails closed.

```sh
node --test packages/github-cloudflare/src/notification-service.test.ts
node --test packages/github-cloudflare/src/notification-isolation-runtime.test.ts
```

The first suite covers independent receipts, replay, redaction, bounded waits and
quarantine. The second uses actual **local** workerd Workflow/SQLite checkpoints,
including two real 20-second timeouts, successful business execution and an
original business failure. These are local fake destinations, not a new Slack,
GitHub or native hosted-provider fault experiment. No permission or credential
is added. The separate [private standalone fixture](../../test/apps/notification-isolation/NATIVE.md)
now has retained native success, genuine business failure and bounded timeout
proofs with independent healthy SQLite delivery. General runtime `onEvent`
callbacks remain separate unfinished acceptance work for #167; this slice does
not close that issue or suppress authoritative callback failures.
