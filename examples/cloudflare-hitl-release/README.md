# Approve a release in Slack

Build on Cloudflare, ask a reviewer in Slack, and release only after approval.

```text
checkout → install → build → wait for approval → release
```

The release action requests `CI.Approval`. Cloudflare suspends the Workflow
until the authorized reviewer selects Approve or Reject on the Slack card.
No container needs to stay alive while waiting.

The snippets on this page come from this example's files, which CI runs end to
end.

## Ask for approval in the release action

In `.cloudflare/ci/actions.ts`, the release action builds first, then requests
approval before it runs the release command:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=release "source {3-8}")

The action does not know whether the question goes to Slack or the terminal.
The host decides. This example prints the release command instead of deploying a
production service.

The checkout, install, and build actions it depends on are ordinary:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L25 "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Requesting the release runs everything
before it:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it on Cloudflare

Export the Worker and the Workflow entrypoint from `src/worker.ts`:

[`src/worker.ts`](./src/worker.ts "source")

Declare the workspace container and the Workflow in `cloudflare.config.ts`:

[`cloudflare.config.ts`](./cloudflare.config.ts "source")

For Slack, follow the [notification and approval setup](../../apps/effect-ci/README.md#discord--slack-notifications-and-hitl).
Credentials and the reviewer list stay with the host.

## Try it locally

```sh
cd examples/cloudflare-hitl-release
effect-ci run --local
```

Local execution asks in the terminal. Release prints a message rather than
deploying a production service.
