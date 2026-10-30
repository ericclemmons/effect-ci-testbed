# Approve a release in Slack

Build on Cloudflare, ask a reviewer in Slack, and release only after approval.

```text
checkout → install → build → wait for approval → release
```

The release action requests `CI.Approval`. Cloudflare suspends the Workflow
until the authorized reviewer selects Approve or Reject on the Slack card.
No container needs to stay alive while waiting.

## Try it locally

```sh
cd examples/cloudflare-hitl-release
effect-ci run --local
```

Local execution asks in the terminal. Release prints a message rather than
deploying a production service.

For Slack, follow the [notification and approval setup](../../apps/effect-ci/README.md#discord--slack-notifications-and-hitl).
Credentials and the reviewer list stay with the host.

[Actions](./.cloudflare/ci/actions.ts) · [Workflow](./.cloudflare/ci/workflow.ts)
