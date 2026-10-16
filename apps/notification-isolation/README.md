# Keep a failed destination out of the business result

This private owned fixture runs the shared CI runtime and notification service.
One destination rejects an actual loopback RPC (or stalls for a bounded timeout),
while another updates one owned SQLite message through real RPC. Success stays
success; the separate business-failure mode must remain errored with its original
cause. Provider failure/status, business conclusion and the final journal view
are recorded in separate zero-retry Workflow checkpoints.

This is a standalone host importing reusable packages, not another app/example's
implementation. It has no Container, shell command, secret, Slack/GitHub token,
model, external destination, public URL, HTTP execution or reset route. The only
runtime metadata binding identifies the actual Worker version; it is not a Git
signature or copied source attestation. Dispatch accepts exactly one fixed mode:
`success`, `business-failure` or `provider-timeout`. Actors cannot supply code,
destinations, identities, credentials, retry counts or policy overrides.

## Reproduce

From the repository root:

```sh
pnpm install
node --test apps/notification-isolation/src/*.test.ts
pnpm --filter @effect-ci-testbed/notification-isolation check
cd apps/notification-isolation
cf build
```

The private fixture is now deployed and its three retained native cases passed
their expected outcomes. Read the [exact native evidence](./NATIVE.md); do not
recreate these operations for proof. The commands below document first setup,
not a rehearsal replay. Before any new owned deployment, anonymously discover the installed CLI's
Worker/Workflow read and deploy commands, read their help, and check that both
`effect-ci-provider-isolation` resources are absent. Stop if either exists rather
than overwriting another resource. Retain exact tested source/build identities,
the current account/resource/automation scope, and a create-only intent. With the
existing authorized account's Worker/Workflow/SQLite capabilities only:

```sh
cf deploy --prebuilt
cf workflows instances create effect-ci-provider-isolation --body '{"instance_id":"owned-provider-success-1","params":{"mode":"success"}}'
cf workflows instances get owned-provider-success-1 --workflow-name effect-ci-provider-isolation
cf workflows instances create effect-ci-provider-isolation --body '{"instance_id":"owned-provider-business-failure-1","params":{"mode":"business-failure"}}'
cf workflows instances get owned-provider-business-failure-1 --workflow-name effect-ci-provider-isolation
cf workflows instances create effect-ci-provider-isolation --body '{"instance_id":"owned-provider-timeout-1","params":{"mode":"provider-timeout"}}'
cf workflows instances get owned-provider-timeout-1 --workflow-name effect-ci-provider-isolation
```

Use each intentional operation once. An uncertain create/upload acknowledgement
requires reading that SAME identity, never blind retry or a new name to hide it.
Preserve the intentionally errored business-failure record. Read the provider and
delivery-status checkpoints, `business-result` and `journal:final`; a green outer
status alone does not prove all destinations delivered. No model call is involved.

## Permissions, costs, limits and cleanup

The proposed host needs one private Worker, one Workflow, one SQLite DO class and
Worker-version metadata. It adds no account permission, secret or outbound binding.
Its deliberate errors are not an enrolled repair source and cannot authorize an
agent proposal. Verify the existing repair capture/admission scope independently
before any native fault experiment; never widen it for this fixture.

Normal Worker/Workflow/RPC requests and DO storage/compute remain metered. The
timeout case actually waits up to 20 seconds. Each owned message is at most 16 KiB
and 64 updates; public HTTP cannot read or write it. There is no inference, paid
browser provider, Container billing, automatic deletion, eviction or reset.

To stop future dispatch, deliberately disable only this fixture's Workflow after
retaining its histories and receipts. Removing this Worker/DO requires explicit
owner cleanup authority and would destroy its private journal; do not do that
merely to refresh proof or conceal a failed operation.

## Boundary

Local tests use genuine workerd/Workflow/SQLite/RPC and remain distinct from the
three [native hosted results](./NATIVE.md). This is not a Slack outage, GitHub delivery proof, HMD
approval or repair automation. Required state/check persistence and approval /
deployment policy still fail closed. General raw runtime callbacks are not made
optional by wrapping provider delivery; remaining #167 acceptance stays explicit.
