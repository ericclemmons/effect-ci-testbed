# CI.Approval

Use `yield* CI.Approval` to get the host's approval service. An action can pause
before a release without choosing Slack, GitHub, or an approval UI itself.

## request

`approval.request({ title, summary, approveLabel?, rejectLabel? })` waits for the
host's decision. Approval returns the decision and optional actor. Rejection or
an unavailable handler fails with `ApprovalError`, so later work does not run.
Planning records the request without asking a reviewer.

[Request before deployment](../../examples/hitl-deploy/.cloudflare/ci/actions.ts#symbol=deploy "source")

The host owns request delivery, reviewer identity, and response handling. An
approval does not independently authorize credentials or deployment targets.

[GitHub](../../examples/hitl-deploy) · [Slack](../../examples/cloudflare-hitl-release)
