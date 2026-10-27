# Actionable lifecycle

See what a local action is waiting for without turning every wait into queued
work. This credential-free recipe runs actual local Effects. It does not deploy
anything, acquire hosted compute, send notifications, or authorize a release.

```sh
cf-ci --workflow examples/actionable-lifecycle/.cloudflare/ci/workflow.ts plan --format=text
cf-ci --workflow examples/actionable-lifecycle/.cloudflare/ci/workflow.ts run --format=text
node examples/actionable-lifecycle/demo.ts
```

[Workflow and selectable local scenarios](./.cloudflare/ci/workflow.ts "source")

[Local walkthrough and card projection](./demo.ts "source")

The default run resolves a prerequisite, fails its local operation once, waits
for the configured retry, then hashes its source as evidence. The walkthrough
also runs a business failure, interrupts a real Effect timer, completes a local
compensation, fails a local compensation, and rejects a decision through an
explicit automated local policy. The policy is not a human click or approval.
Compensation only returns local values; it is not proof of a deployed rollback.

Each scenario prints the runtime transitions, final card snapshot, and whether
replaying an earlier captured execution event changes the terminal card. The
walkthrough renders locally; it makes no Slack requests. The host keeps its
existing acknowledged root-message identity and notification quarantine.

Unobserved compute queue and startup times remain `null`. Observed intervals
can legitimately be zero at the timestamp's millisecond resolution. Decision,
evidence, dependency and retry waits are not counted as execution time.

[Lifecycle contract and integration boundary](../../packages/ci/LIFECYCLE.md)

[Local verification record](./verification.md)
