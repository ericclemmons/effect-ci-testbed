# Follow retries and reruns

One owned check fails on execution attempt 1 and succeeds on attempt 2. An explicit
workflow rerun retries that check under a new workflow attempt, while reusing the
other branch's completed output. The logical run and step names stay the same.

[Actions](./.cloudflare/ci/actions.ts "source")

[Workflow](./.cloudflare/ci/workflow.ts "source")

Run a single invocation through the normal CLI:

```sh
cf-ci run --workflow examples/run-identities/.cloudflare/ci/workflow.ts --format=json
```

Run the combined SDK journey from the repository root:

```sh
node examples/run-identities/.cloudflare/ci/journey.ts
```

[Journey](./.cloudflare/ci/journey.ts "source")

The journey prints both immutable attempt details, execution numbers, reused
output origins, notification **previews**, and whether an old event was accepted.
It uses local Effect execution and the real RunCard reducer. It sends no messages,
creates no checks, and starts no hosted runs. The Git revision is the checkout's
HEAD; an uncommitted working tree is not a published-revision attestation.

## Proof boundary

Local execution and existing native-adapter tests are not a new deployed
Cloudflare/GitHub/Slack proof. Issue #168 stays open until this combined journey
runs in an approved owned target environment and an intentional notification
exposes its real attempts. Existing snapshot and native retry proofs remain in
[the native rerun fixture](../../apps/effect-ci/verification/native-rerun).

See the [correlation contract](../../packages/ci/correlation.md) for identity
scope, replay limits, and dependencies on #169–#171.
