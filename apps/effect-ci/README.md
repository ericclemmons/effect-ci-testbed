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
The `standalone` profile runs a host-authored package-script policy at the configured
project root. It does **not** yet discover and execute arbitrary repositories'
`.cloudflare/ci/workflow.ts` files.

The existing `demo` profile retains this account's integrations for compatibility.
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
the earlier release integration.

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
