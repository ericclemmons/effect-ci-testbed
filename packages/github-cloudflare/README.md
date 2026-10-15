# Hosted workflow continuation

`workflowEntrypoint(definition, { finalize })` supports a trusted host continuation
after successful CI actions. The callback receives the actual workflow result as
`value`, the existing `RunCard`, host `environment`, canonical run `parameters`,
`instanceId`, native `step`, and `publish(key, presentation?)`.

This is host code configured at deployment, not uploaded repository code or a
remote Workflow parameter. Validate the result's identity before granting any
external capability. Use native sibling `step.do`/`waitForEvent` calls for durable
work; the callback itself is not an automatically retried checkpoint.

The successful CI terminal event is held until this callback returns. Callback
failure fails the native Workflow and GitHub summary; successful build checks
remain truthful build checks. Build failure never enters the continuation.
Without `finalize`, existing reporting and return values are unchanged.

`publish` updates the same acknowledged Slack bot message rather than opening a
separate release card. Stable keys must match `[A-Za-z0-9:_-]{1,128}`. Host updates
use zero retries and a 20-second timeout, and delivery rejection fails closed.
A missing build-card acknowledgement or a Slack webhook-only destination cannot
create a replacement review card. After an update failure, a distinct terminal
failure may update an already-known message once; it never retries the failed
update. Notification credentials remain host-only.

This extension does not itself authenticate a human decision, acquire a release
lease, promote a version, or commit a rollout. No demo continuation is enabled
by adding the optional API. The dynamic candidate controller, signed human
decisions and push routing must be integrated separately before live acceptance.

```sh
node --test packages/github-cloudflare/src/finalizer-runtime.test.ts
pnpm --filter @effect-ci-testbed/github-cloudflare check
```

The regression uses the actual local native Workflow runtime with a fake Slack
transport: success, release failure, build failure, missing root acknowledgement,
failed host update and unchanged default behavior. It creates no external review,
deployment, token, paid inference or native cloud run; it is not live Slack/HMD
evidence. No new configuration, account permission, resource or dependency is
required. Removing `finalize` restores the previous host behavior without deleting
history or notification records.
