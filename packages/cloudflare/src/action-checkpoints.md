# A failed checkpoint ACK is not a rolled-back side effect

Native action bodies and the Workflow checkpoint that acknowledges them are
different boundaries. A publisher can commit immutable bytes before the platform
loses the checkpoint acknowledgement. A failed Workflow therefore does not prove
that publication never happened, and a successful GET does not make that failed
Workflow successful.

The shared native action adapter recognizes only the exact provider message
`Attempt failed due to internal workflows error` from an ordinary Error or the
fixed WorkflowInternalError protocol. It reports `ActionCheckpointError`,
`stage=checkpoint-ack`, the existing step identity and `effects=unknown`. It copies
no remote stack, request, Durable Object ID, arbitrary cause or credential.
Ordinary business errors, command diagnostics and non-retryable subclass policy
retain their original semantics.

This diagnostic adds no retry, restart, rollback, success conversion or automatic
reconciliation. Existing action policy remains unchanged. Inspect the retained
failed attempt, then read the **same** external artifact/operation identity and
verify its actual bytes and ownership before deciding what recovery is allowed.
Do not create a new identity or blindly POST again after an uncertain ACK.

## Observed native failure; local diagnostic regression

On October 16, main source `8d8e8f96401c9bdaad3caa84f6bee53e44f93d39`, instance
`44ec2360-c957-11f1-8e06-7baabfb5c768`, failed its single zero-retry `publish site`
checkpoint after 13 seconds with a native WorkflowInternalError. Separate private
telemetry retained a retryable "Durable Object instance is no longer active"
connection error. An independent GET found the exact immutable preview present;
the live release allocation remained at its prior version, 100%. No release claim
was reached and no old operation was retried or reset. These observations do not
establish which platform component closed that connection or fix that component.

The new local regression executes a body once, then simulates the native lost ACK.
It requires the original action to stay failed, the body write count to remain one,
and the acknowledgement diagnostic to retain `effects=unknown`. This is a test of
the adapter, **not** another native failure or proof that the new message has been
deployed. The historical failed instance remains unchanged.

```sh
node --test packages/cloudflare/src/action-checkpoint-error.test.ts apps/example-runner/src/action-step.test.ts
```
