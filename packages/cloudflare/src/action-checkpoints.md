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

The command boundary uses a distinct `CI.CommandCheckpointError`, part of the
`CI.CommandFailure` union returned by workspace/package-manager commands. It has
`processExitCode:null` and **no** invented `exitCode:1`, stdout or stderr. Ordinary
verified child failures remain `CI.CommandError` with their actual exit/status
and bounded output. The CLI reports `CI_COMMAND_OUTCOME_UNKNOWN` with this metadata;
the CLI's own failure exit is not presented as a child process exit.

Likewise, a container RPC/setup/output exception produces `CI.CommandExecutionError`
with `stage=container-execution`, an unknown process exit and no provider cause text.
That distinction diagnoses missing results; it does not establish why a container
operation failed or prove that its command did not run.

This diagnostic adds no retry, restart, rollback, success conversion or automatic
reconciliation. Existing action policy remains unchanged. Inspect the retained
failed attempt, then read the **same** external artifact/operation identity and
verify its actual bytes and ownership before deciding what recovery is allowed.
Do not create a new identity or blindly POST again after an uncertain ACK.

## Container snapshots

Workspace mutations have a durable owner/input marker, written before commands.
An evicted provider object can reuse the same running container without restoring
its ancestor over uncommitted files. If that container has stopped, recovery fails
explicitly; it does not restart an older snapshot or rerun commands.

Final action commits are immutable. A saved snapshot and cleared mutation marker
are recorded together. A lost storage or container-release acknowledgement returns
that same saved snapshot on retry, without capturing an older workspace again.
User-named intermediate checkpoints retain their existing behavior.

The regression uses the actual workspace class with simulated container/storage
failures. It covers eviction, container loss, foreign action/input rejection, and
lost storage/release acknowledgements. This does not fix Cloudflare's underlying
snapshot service or turn the retained failed native run into a success.

```sh
node --test apps/effect-ci/src/workspace-snapshot-recovery.test.ts apps/effect-ci/src/artifact-revision-runtime.test.ts
```

## Observed native failure; local diagnostic regression

On October 16, main source `8d8e8f96401c9bdaad3caa84f6bee53e44f93d39`, instance
`44ec2360-c957-11f1-8e06-7baabfb5c768`, failed its single zero-retry `publish site`
checkpoint after 13 seconds with a native WorkflowInternalError. Separate private
telemetry retained a retryable "Durable Object instance is no longer active"
connection error. An independent GET found the exact immutable preview present;
the live release allocation remained at its prior version, 100%. No release claim
was reached and no old operation was retried or reset. These observations do not
establish which platform component closed that connection or fix that component.

The separate PR313 preview at `fc44653b99d8749a6f1c9ed7fb794d9f8fb3298d`, instance
`0258ea90-c959-11f1-8c15-eb8af09020ef`, hit a native internal error after ten minutes
in its single install checkpoint. Its older runner reduced that to a generic
"npm ci exit 1". There is no verified child exit/result in that history. It remains
errored; this observed diagnostic gap motivated the new distinct unknown-outcome
type rather than a retry of the old command.

The new local regression executes a body once, then simulates the native lost ACK.
It requires the original action to stay failed, the body write count to remain one,
and the acknowledgement diagnostic to retain `effects=unknown`. This is a test of
the adapter, **not** another native failure or proof that the new message has been
deployed. The historical failed instance remains unchanged.

```sh
node --test packages/cloudflare/src/action-checkpoint-error.test.ts test/apps/example-runner/src/action-step.test.ts test/apps/example-runner/src/command-step.test.ts packages/cli/src/command-failure.test.ts
```
