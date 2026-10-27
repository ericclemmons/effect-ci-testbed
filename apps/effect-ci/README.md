# Effect CI host

Run GitHub CI as native Cloudflare Workflows. GitHub shows checks; Slack can show
progress and review controls. Project commands run in containers, not in the host.

- [Try the standalone Vite tutorial](../../examples/demo/README.md).
- [Deploy your own host](./SELF-HOST.md).
- [Keep GitHub Actions YAML with the optional runner](../github-actions-runner/README.md).

## This repository's CI/CD

The signed GitHub App event selects the [root workflow](../../.cloudflare/ci/workflow.ts):
install, check, test, build, and test/build the tutorial. Main then deploys the two
product apps, `github-actions-runner` and `effect-ci`, sequentially:

```sh
pnpm build
cf workers triggers deploy --prebuilt
cf deploy --prebuilt
```

There is no HMD gate or separate release broker in this path. The tutorial under
`examples/demo` and test hosts under `test/apps` are tested, never automatically
deployed. Supporting GitHub Actions jobs do not hold Cloudflare deployment credentials.

Cloudflare and registry credentials stay in the host Worker's environment/memory.
The container's outbound HTTPS proxy authenticates only the authorized main deploy
commands; Node and Docker receive dummy login values and trust the runtime proxy CA.
A failed or uncertain publication is inspected, not blindly replayed.

## Host configuration

[SELF-HOST.md](./SELF-HOST.md) covers the App, secrets, Access and CLI setup.
The `standalone` profile checks out the caller's Git origin at the requested HEAD,
installs dependencies, and runs the same CLI inside the container at the repository
root by default. It discovers `.cloudflare/ci/workflow.ts` or conventional package
scripts there. `cf-ci run build --remote` selects the repository's build action;
no target runs its whole workflow. The host never imports repository workflow code.

The existing `demo` profile retains this account's integrations for compatibility.
Its root `/capabilities` and `/runs` API also runs arbitrary caller repositories
through `RepositoryCIWorkflow`, using the existing host API token and Access
application. These runs always start at the repository root in the unprivileged
`repository` image. `/demo` and `/showcase` retain their separate policies and
workflows. A new repository does not require a new hostname or new credentials.
The [retained same-host proof](./verification/repository-head/2026-10-23.json)
records a successful `cf-ci run build --remote` for the standalone demo's exact
pushed HEAD and a real unknown-target failure. The client used automatic
`.env.local` settings and the existing credentials. Live Access and legacy demo
capabilities were checked separately; this is an execution receipt, not signed evidence.
Installing the App on all repositories grants repository access; it does not enroll
signers, deployment credentials, repair authority or reusable-check policies for them.

### 5. Run the first Workflow

After [setup](./SELF-HOST.md#run-ci), commit and push to an installed repository.
A signed `check_suite` event starts ordinary CI at the exact commit and reports
per-action checks. Explicitly enrolled preview/release branches use the signed Push
event so moving the same checked SHA between refs still creates the branch-owned
attempt. Redelivery of the same delivery ID does not create another run.
For remote CLI execution, use a clean pushed commit and your configured host:

```sh
cf-ci run --remote
```

Remote execution selects the host's advertised policy, not an uploaded local module.
`cf-ci doctor --remote` is an optional, non-dispatching preflight; normal commands
also negotiate authentication and capabilities.

## Trusted results and PR policy

The [trusted remote guide](./TRUSTED-REMOTE.md) records real signed test/build reuse,
remote-to-SCM verification and App PR approvals. It distinguishes retained runs from
current deployment state. Reuse retains the original execution identity; it is not
a claim that the command ran again or permission to skip arbitrary checks.

The [PR workflow](./src/workflows/pull-request.ts) composes
`inspect PR → review → approve PR`. The host supplies canonical evidence and a
journaled exact-head writer. This path does not merge a PR or bypass GitHub rules.
Inspect its plan without credentials or API writes:

```sh
cf-ci --workflow apps/effect-ci/src/workflows/pull-request.ts plan approve
```

### Enrolled demo syntax-check reuse

[Receipt and policy contracts](../../packages/cloudflare/src/trusted-runner-receipts.md)
and [retained acceptance](./TRUSTED-REMOTE.md) describe the fixed enrollment.
These are not automatic enrollment for a fresh copy of the tutorial.

## Discord / Slack notifications and HITL

[Notification setup](./SELF-HOST.md#notifications) is optional and separate from
approval authority. Host policy selects which runs notify. The root CI/CD workflow
has no human gate. The [HITL example](../../examples/cloudflare-hitl-release/README.md)
shows an explicit approval action; [demo release evidence](./DEMO-RELEASE.md) retains
the earlier release integration. The [human walkthrough handoff](./HUMAN-REVIEW.md)
separates that signed, delegated execution from the independent human evidence
still required by issue #141. Do not replay a release to refresh old documentation.

### Separate health-mediated approval lab

The [release-manager test host](../../test/apps/release-manager/README.md) and
[historical lab notebook](https://github.com/ericclemmons/effect-ci-testbed/blob/1fbbfaeaef45a265105a42eeb3078865fe620944/apps/effect-ci/README.md#separate-health-mediated-approval-lab)
retain the experimental sampling and rollback work. They are not required for CI/CD
or started by ordinary pushes. Old dispatch/reset commands are history, not demo setup.

## Repair and diagnostics

[PUBLIC-REPAIR.md](./PUBLIC-REPAIR.md) records the earlier error → verified, unmerged
repair proposal. It is not an always-on AI loop or a fresh public trigger.
The human tutorial models agentic flows without enabling paid inference.

[Structured logs](../../packages/cloudflare/src/wobs-logging.md) retain workflow,
step and retry context. [Checkpoint handling](../../packages/cloudflare/src/action-checkpoints.md)
distinguishes an uncertain acknowledgement from an unapplied operation.

The [legacy fixture](../../test/fixtures/demo/README.md) and
[original host notebook](https://github.com/ericclemmons/effect-ci-testbed/blob/1fbbfaeaef45a265105a42eeb3078865fe620944/apps/effect-ci/README.md)
retain earlier instance IDs, failures and proofs. They are not installation steps.


## Unified CLI and workload identity

This shared app handles repository OIDC enrollment, remote dispatch, status/log
reads, and short-lived Cloudflare deployment credentials. It retains the existing
monorepo, demo, showcase, repair, and repository workflow exports.

Locally, authenticate with `cloudflared access login --quiet <service-origin>`, then
run `cf-ci oidc --service <service-origin>` from the project. Commit the generated
`.cloudflare/ci/oidc.json`; it contains only the service origin and repository name.
`cf-ci doctor --remote` and `cf-ci run --remote` then reuse the Access identity;
a separate Effect CI API token is no longer required for these operator routes.
Existing private API profiles remain compatible.

In GitHub Actions, grant the job `id-token: write` and set the public
`EFFECT_CI_REMOTE_URL`. `cf-ci oidc` enrolls only the repository identified by the
signed job token, after verifying its GitHub App installation and allowed numeric
owner. CI enrollment does not modify the checkout. `cf-ci run --remote` automatically
requests fresh identity tokens for dispatch, status, and log requests. It sends no
Access credentials or stored Effect CI API token. Other repositories, mismatched
commits, and cross-repository run reads are rejected. Workloads cannot approve
releases or use operator routes.

Human routes remain behind Access. The `/api` machine routes, `/token`, and
`/revoke` bypass interactive login but authenticate verified workload identities
or revocation receipts in the Worker. GitHub and Slack webhooks retain their own
signature protocols. These are distinct audiences and permissions, not one
unrestricted token accepted everywhere.

Hosted repository runs receive an internal five-minute identity through the
host-owned process environment. It is not put into command text, snapshots, or
durable Workflow checkpoint values. `cf-ci oidc -- pnpm exec cf deploy` (or Wrangler)
exchanges it for a 15-minute Cloudflare credential and revokes that credential
when the child exits, including on failure. This internal JWT is not a public
third-party OIDC provider.

Remote-CI identity needs the GitHub App credentials, the allowed owner IDs, and a
signing key. Cloudflare deployment authority is optional: configure an account
and approved scope map only when projects need Cloudflare deployment. New Worker
creation requires account-scoped Workers Scripts Write; the old single-Worker
Editor policy cannot create a Worker. The issuer credential stays host-only.

[Repository and run authorization](./src/remote-identity.ts "source")

[OIDC operator configuration](./secrets.example.env "source")

[CLI workload identity](../../packages/cli/src/workload-auth.ts "source")

[Live shared-app enrollment, remote execution, new-Worker deployment and cleanup proof](./verification/oidc-shared-app.json "source")

[Account permission creation probe](./verification/oidc-worker-creation.json "source")
