# Hosted workflow continuation

## Remote private checkout

`workflowEntrypoint(definition, { remoteGitHubCheckout: true })` lets a self-hosted
runner check out private GitHub sources using its own installed App. The host
resolves the installation from GitHub, requests Contents-read access to that one
repository, and revokes the token after clone/fetch. Neither the App key nor its
token enters project files, native checkpoint results or CLI parameters.

No installation means anonymous checkout; other public Git providers never
receive a GitHub credential. Redirects, installation mismatches, extra token
permissions and revocation failures fail closed. The option is off by default;
signed GitHub-event checkout and existing hosts keep their current behavior.
The standalone host opts in. Local native Workflow/RPC tests cover both checkout
paths (including the cache's source inspection), not a live private deployment.

## Record execution attempts

`onAttempt(attempt, context)` journals the actual kernel result in a host-only
native checkpoint, including passed outputs in a failed workflow. It runs before
`finalize`; it does not treat a passed build as a released application. Both native
adapters share the [recording contract](../cloudflare/src/host-attempt.md).
The operator supplies storage/signing policy; no generic issuer or automatic
result reuse is enabled by adding this callback.

## Continuation

`workflowEntrypoint(definition, { finalize })` supports a trusted host continuation
after successful CI actions. The callback receives the actual workflow result as
`value`, the existing `RunCard`, host `environment`, canonical run `parameters`,
`instanceId`, native `step`, host-owned `exports`, and `publish(key, presentation?)`.

This is host code configured at deployment, not uploaded repository code or a
remote Workflow parameter. Validate the result's identity before granting any
external capability. Use native sibling `step.do`/`waitForEvent` calls for durable
work; the callback itself is not an automatically retried checkpoint.

The successful CI terminal event is held until this callback returns. Callback
failure fails the native Workflow and GitHub summary; successful build checks
remain truthful build checks. Build failure never enters the continuation.
Without `finalize`, existing reporting and return values are unchanged.

By default, `publish` updates the same acknowledged Slack bot message rather than opening a
separate release card. Stable keys must match `[A-Za-z0-9:_-]{1,128}`. Host updates
use zero retries and a 20-second timeout, and delivery rejection fails closed.
One transport-level exception applies to an existing Slack message containing a
private image: a definite `invalid_blocks` rejection may retry the identical
serialized update three times after 500/1000/2000 ms. No initial post, HTTP or
network failure, malformed/lost acknowledgement or other API error is retried.
Receipts expose only bounded failure categories and validation-retry counts.
A missing build-card acknowledgement or a Slack webhook-only destination cannot
create a replacement review card. After an update failure, a distinct terminal
failure may update an already-known message once; it never retries an ambiguous failed
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

## Compact Slack status and threaded details

`slackLayout: "status-thread"` keeps one parent summary: the workflow title,
rotating current status/step, linked source/details and latest health graph.
The final result retains that graph. No checklist or approval capability appears
on the parent. The owned demo opts into this layout;
other hosts keep their existing presentation unless they opt in.

The first reply is a maintained Status/Step table. Step names link to their
evidence replies; Dashboard and Preview stay beside the source link on the parent.
Declared progress shows one segment per step and keeps the last completed step.

`slackCommandOutput: "failed"` adds bounded, redacted command output to failed step
replies. The owned demo also supplies `slackCommandLog`: long output becomes a text
snippet in the same channel and parent thread, with a short inline excerpt.
These are retained stdout/stderr tails, not unlimited process logs. A host-only
Durable Object records upload intent before allocation; lost acknowledgements
never allocate another file. Unavailable snippets retain the inline fallback.
No public file URL, new Slack scope or project-side credential is required.

Each running step gets one maintained, non-broadcast reply containing only that
step's status and evidence—no numbering or repeated workflow/source/details header.
Host continuations
can use `publish(key, presentation, threadKey)` to keep a review's graph,
explanation and controls together in that same phase reply; settling updates it
to remove the controls. Full semantic history and GitHub reporting are unchanged.

Thread creation first acknowledges a capability-free/image-free placeholder,
then updates that known reply with details. Native thread checkpoints have zero
retries. A lost/invalid post ACK blocks that reply rather than posting a replacement;
required host review delivery fails closed. Only an acknowledged image update
retains the existing narrowly bounded `invalid_blocks` exception. No new scope,
channel or permission is needed. Webhook-only Slack and Discord retain their
existing behavior. Existing historical messages are not rewritten or replayed.

## Optional presentation failure isolation

Ordinary maintained-card and thread checkpoints have zero retries and a
20-second timeout. A checkpoint exception records a redacted
`notification-delivery-failed:*` receipt when storage is available, blocks that
uncertain presentation path for reconciliation, and leaves the business outcome
unchanged. Additional notification providers still receive later semantic
snapshots. An unacknowledged root is never posted again on a subsequent event.

This does **not** suppress authoritative state/checkpoint failures, authorize an
approval, or ignore required host review delivery: `finalize.publish` still fails
closed. Failed review delivery retains the controller's configured recovery
policy. Generic user `onEvent` callbacks and provider-level timeout/reconciliation
contracts remain separate work in #167; this is not completion of that issue.

```sh
node --test packages/github-cloudflare/src/notification-isolation-runtime.test.ts
```

The local workerd/SQLite regression injects synchronous throws, rejected promises
and an actual 20-second timeout inside the real durable notification checkpoint.
It checks successful and failed business
outcomes, a healthy second provider, no repeated destination attempt, the bounded
policy and redacted receipt. Notification endpoints are fake; no live delivery
or cloud failure-isolation proof is claimed.
