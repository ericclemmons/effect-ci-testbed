# Keep a commit's execution history

One private Durable Object per issuer, repository and commit. Every native
instance/attempt gets an immutable signed record. No branch alias or latest-pass
flag replaces the history.

```ts
import { executionCommitName, executionJournal } from "@effect-ci-testbed/cloudflare/execution-journal";

export const CommitExecutions = executionJournal({
  keys: environment => host.trustedPublicKeys(environment),
});

// Inside the trusted host's onAttempt callback:
const journal = context.exports.CommitExecutions.getByName(
  await executionCommitName(identity),
);
await journal.record(identity, JSON.stringify(receipt));
```

Register this export as a SQLite Durable Object in your Worker configuration.
The host supplies trust; receipts cannot enroll their own keys. Keep this binding
away from project code. The Durable Object's HTTP handler returns 404.

`record` verifies before writing. Identical concurrent writes create one record;
a conflicting record for the same instance/attempt fails without overwriting it.
`get(identity, instanceId, attempt)` re-verifies exact inputs and current trust.
A missing, changed-input or revoked-key result is unavailable, not a cache hit.
Reconcile a lost acknowledgement by reading the same identity—never by creating
a new run or erasing the failed native workflow.

`history(subject, after?)` returns at most 25 currently verified receipts, an
unverified count and an opaque `next` cursor. Pages use stable record-key order,
not chronological order. Removed keys leave stored history intact. Storage has
no delete/overwrite endpoint or arbitrary lifetime run cap; provider quotas still
apply.

Receipts contain output commitments, not private snapshot capabilities or video
bytes. Artifact storage, availability and output restoration are separate. This
journal does not choose reuse, approve a PR, execute project code or deploy it.

The local proof uses an actual native Workflow and SQLite/RPC, then reloads the
worker, withdraws trust and restores it without rerunning the native job. Extra
history entries come from local kernel fixture executions. Source/input/runtime
identities and keys are fixtures; this is not a deployed generic issuer or a full
hosted dependency-aware reuse proof.
