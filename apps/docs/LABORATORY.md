# Laboratory reference

Internal wiring for this repository, not setup for a new app.

## This repository's CI and CD

The root [workflow](../../.cloudflare/ci/workflow.ts) runs monorepo checks, platform
tests, SDK build, and the tutorial's normal test/build. GitHub Actions runs the
shared validation entrypoint on PRs and `main`. Recipe checks remain enabled
for demo-only edits.

```sh
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
effect-ci plan
effect-ci run
```

The signed GitHub App event selects the root workflow for native Cloudflare
execution. The host imports that workflow directly, like the other examples.
After validation, a push to `main` builds each product app and runs:

```sh
cf workers triggers deploy --prebuilt
cf deploy --prebuilt
```

That's ordinary CD, including the declared infrastructure—not a separate
code-only publisher, HMD gate, version-management protocol or manual deploy goal.
A failed check prevents deployment. A failed trigger/deploy command stops later
apps. The runner must have Cloudflare deployment credentials and a working
Docker daemon for app image builds; an App installation is not a Cloudflare
deployment credential. Supporting GitHub validation jobs do not receive those
credentials. Nothing here arms an AI flow or uploads a new secret.

The native host's CI image includes Node, pnpm and Docker. Its configured
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are supplied to the main
deployment commands as per-process environment values, not command arguments or
workspace files. Check/build/fixture commands do not receive them. The local
workflow uses your existing CLI login.

`examples/demo` is a human tutorial/template, not a monorepo deployment target.
Its copied repository owns its own `main` and eventual release policy. The
monorepo's App webhook no longer starts the legacy demo preview or human release
gate. Repair/AI apps and verification fixtures are also excluded from this
enrolled platform deployment path. Discovery alone never grants CD authority.

## Repository layout

- `apps/effect-ci`: the native CI host.
- `apps/github-actions-runner`: optional GitHub OIDC credentials and Actions execution.
- `examples/demo`: the standalone, copy-out human tutorial; tested, not deployed.
- `test/apps`: deployable test hosts (repair, HMD, preview, notification and
  hosted-example fixtures). They are not required product installations or CD targets.
- `test/fixtures/demo`: the retained hosted demo/proof app and its original evidence.
- `packages`: reusable runtime, CLI and provider packages.

Moving a test host does not delete its deployed resources or enable it. The
repair fixtures remain separately operator-controlled; normal CI does not
invoke a model or replay an incident.

The [live demo proof](../effect-ci/TRUSTED-REMOTE.md) records exact runs and
limits. Remote execution requires a pushed commit and an enrolled host program;
it does not upload arbitrary workflows. Signed reuse is exact-commit, not
cross-merge proof. This is a testbed, not a production-readiness claim.

## Execution model

Actions own prerequisites. Workflows request goals:

[Repository workflow](../../.cloudflare/ci/workflow.ts#symbol=default "source")

- Shared prerequisites run once. Parallelism is explicit.
- Source and runner adapters change where work runs, not the action definitions.
- Caching reuses task output. Attestation verifies exact committed inputs; they
  are different capabilities.
- Failed commands retain bounded stdout/stderr. A nonzero exit code is failure,
  including when a custom executor returns it instead of throwing.
- Remote runs select an enrolled hosted program; they do not upload local code.

Host SDK: [record actual attempts](../../packages/cloudflare/src/host-attempt.md),
[sign check/action results](../../packages/cloudflare/src/execution-receipt.md), and
[keep private commit history](../../packages/cloudflare/src/execution-journal.md).
These hooks do not automatically enroll a signer or prove that outputs remain
available. Reuse and PR approval stay in host/workflow policy.

[SDK and adapter contracts](../../packages/ci/README.md) ·
[Hosted setup](../effect-ci/README.md) ·
[Examples](../../examples/README.md)

## Deployable apps

[`apps/github-actions-runner`](../github-actions-runner/README.md) is an optional
GitHub Actions runner on Cloudflare Containers: change `runs-on`, keep native YAML
steps and logs. It is separate from Effect CI's native Workflow runner and reuses
the existing GitHub App with optional runner permissions. Its private-fixture
[live proof](../github-actions-runner/README.md#verification) includes
checkout, Node/pnpm setup, install, build, native logs and ephemeral cleanup.

[`apps/effect-ci`](../effect-ci/README.md) contains the self-hosted Cloudflare
service and step-by-step setup: `cf` deployment, GitHub App integration, Cloudflare
Access protection, remote runs, and live Slack checklists with inline release approval.
Native hosted builds, real GitHub webhook/check delivery with logs, and Slack approval
have been exercised, including Access-authenticated CLI remote dispatch and event-stream
reconnection. See the guide for credentials and the exact supported remote contract.

[`test/apps/example-runner`](../../test/apps/example-runner) hosts unchanged consumer workflows
for real Cloudflare coverage checks, separately from the GitHub/Slack service.

Workflows and exported actions serve different entrypoints:

- A workflow routes normalized external events. `CI.when` keeps event/ref predicates
  inspectable in the plan; ordinary Effect matching can route runtime-only payloads.
  A push, deleted branch, deployment hook, or observability issue can therefore enter
  the same program and request a different desired outcome.
- Actions become local and agent commands only when the workflow deliberately
  re-exports them. `effect-ci list` shows that narrow public surface and `effect-ci run check`
  invokes a target with all of its prerequisites. Internal checkout, install, and
  deployment actions stay private by default.
- Bare `effect-ci` prints help, including list/plan/Mermaid usage and configured project
  targets, without executing or initializing a project.
- `effect-ci run test build` creates an on-demand parallel workflow from exported
  actions, sharing their declared prerequisites once. All targets are validated
  before execution. Remote goals must be advertised by the host; the demo supports
  test/build. Check access and available goals with `effect-ci doctor --remote`.
- Running `effect-ci run` with no target executes the default workflow using the local event
  adapter. This is useful for full local validation, but agents can choose the smallest
  exported action instead of pretending to emit a GitHub event.
