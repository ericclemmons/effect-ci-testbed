<img src="./apps/effect-ci/assets/bolt-stack.svg" alt="Effect CI layered lightning logo" width="96" height="96">

# Effect CI testbed

> Experimental prototype. The examples are the product specification.

**CI isn't a pipeline. It's a flywheel.** Check a change, reuse trustworthy
evidence, release it, observe it, and turn failures into verified repair proposals.

## Try it locally

Use Node 24.11+ or Node 26+. From a clone:

```sh
pnpm install
pnpm build
export PATH="$PWD/node_modules/.bin:$PATH"
cd examples/demo
cf-ci list
cf-ci plan test build --format=mermaid
cf-ci run test build
```

Keep your package scripts. Help, list and plan inspect them without creating
files. The first local run adds an empty CI marker; an authored workflow takes
precedence. Humans get text, detected agents get JSON. Use `--format` to override.

[Walk through the demo](./examples/demo/README.md) for remote setup, Slack,
previews, test attestation and the real error-to-unmerged-PR proof.
[Browse recipes](./examples/README.md) for one focused capability at a time.

## What works

- Run the same actions locally, on GitHub Actions or on the hosted Cloudflare runner.
- Verify remote tests and restore signed build snapshots in later SCM runs.
- Approve eligible README-only PRs without a model; leave code changes for review.
- Push a branch for a preview. Release main through Slack's Progress/Reject gates.

The [live demo proof](./apps/effect-ci/TRUSTED-REMOTE.md) records exact runs and
limits. Remote execution requires a pushed commit and an enrolled host program;
it does not upload arbitrary workflows. Signed reuse is exact-commit, not
cross-merge proof. This is a testbed, not a production-readiness claim.

## Execution model

Actions own prerequisites. Workflows request goals:

```ts
import * as CI from "@effect-ci-testbed/ci"
import * as actions from "./actions.ts"

export { test, build } from "./actions.ts"

export default CI.workflow("project", function* () {
  return yield* CI.parallel([actions.test(), actions.build()])
})
```

- Shared prerequisites run once. Parallelism is explicit.
- Source and runner adapters change where work runs, not the action definitions.
- Caching reuses task output. Attestation verifies exact committed inputs; they
  are different capabilities.
- Failed commands retain bounded stdout/stderr. A nonzero exit code is failure,
  including when a custom executor returns it instead of throwing.
- Remote runs select an enrolled hosted program; they do not upload local code.

Host SDK: [record actual attempts](./packages/cloudflare/src/host-attempt.md),
[sign check/action results](./packages/cloudflare/src/execution-receipt.md), and
[keep private commit history](./packages/cloudflare/src/execution-journal.md).
These hooks do not automatically enroll a signer or prove that outputs remain
available. Reuse and PR approval stay in host/workflow policy.

[SDK and adapter contracts](./packages/ci/README.md) ·
[Hosted setup](./apps/effect-ci/README.md) ·
[Proof requirements](./examples/PROOF-PAGES.md)

## Deployable apps

[`apps/github-actions-runner`](./apps/github-actions-runner/README.md) is an optional
GitHub Actions runner on Cloudflare Containers: change `runs-on`, keep native YAML
steps and logs. It is separate from Effect CI's native Workflow runner and reuses
the existing GitHub App with optional runner permissions. Its private-fixture
[live proof](./apps/github-actions-runner/README.md#verification) includes
checkout, Node/pnpm setup, install, build, native logs and ephemeral cleanup.

[`apps/effect-ci`](./apps/effect-ci/README.md) contains the self-hosted Cloudflare
service and step-by-step setup: `cf` deployment, GitHub App integration, Cloudflare
Access protection, remote runs, and live Slack checklists with inline release approval.
Native hosted builds, real GitHub webhook/check delivery with logs, and Slack approval
have been exercised, including Access-authenticated CLI remote dispatch and event-stream
reconnection. See the guide for credentials and the exact supported remote contract.

[`apps/example-runner`](./apps/example-runner) hosts unchanged consumer workflows
for real Cloudflare coverage checks, separately from the GitHub/Slack service.

Workflows and exported actions serve different entrypoints:

- A workflow routes normalized external events. `CI.when` keeps event/ref predicates
  inspectable in the plan; ordinary Effect matching can route runtime-only payloads.
  A push, deleted branch, deployment hook, or observability issue can therefore enter
  the same program and request a different desired outcome.
- Actions become local and agent commands only when the workflow deliberately
  re-exports them. `cf-ci list` shows that narrow public surface and `cf-ci run check`
  invokes a target with all of its prerequisites. Internal checkout, install, and
  deployment actions stay private by default.
- Bare `cf-ci` prints help, including list/plan/Mermaid usage and configured project
  targets, without executing or initializing a project.
- `cf-ci run test build` creates an on-demand parallel workflow from exported
  actions, sharing their declared prerequisites once. All targets are validated
  before execution. Remote goals must be advertised by the host; the demo supports
  test/build. Check access and available goals with `cf-ci doctor --remote`.
- Running `cf-ci run` with no target executes the default workflow using the local event
  adapter. This is useful for full local validation, but agents can choose the smallest
  exported action instead of pretending to emit a GitHub event.

## Recipes by feature

Choose a group by the job you need to solve. Within each group, simpler ingredients
come before recipes that compose them. The [recipe guide](./examples/README.md)
provides suggested learning paths and explains the boundaries between similar examples.

Rows marked for conventional GitHub Actions include comparison YAML alongside the
portable Effect CI version. ✅ means end-to-end execution in that actual environment;
local `cf dev` counts as Local, not Cloudflare. 🔜 means unverified roadmap coverage,
not necessarily missing code; — means the execution model is irrelevant. Moving a
recipe into a group does not change its verification status.

`· containerless` is a capability label in the **Effect CI Cloudflare** column,
not another execution environment. `✅ · containerless` means the entire recorded
recipe ran without a Container; `🔜 · containerless` is a planned containerless
path, not verified support. An unlabeled cell is not a claim that a container is
required. Source ingestion, checks/builds, and deployment must each be classified;
a DO-backed source ingredient alone does not make the downstream pipeline containerless.

### Author a workflow

Start with a conventional pipeline, then choose explicit actions or task discovery.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run CI with npm](./examples/node-npm) | ✅ | ✅ | ✅ | ✅ |
| [Run CI with pnpm](./examples/node-pnpm) | ✅ | ✅ | ✅ | ✅ |
| [Discover checks automatically](./examples/zero-config) | ✅ | ✅ | ✅ | ✅ |
| [Run a single check from the CLI](./examples/exported-actions) | ✅ | ✅ | ✅ | ✅ |
| [Check changes before pushing](./examples/demo) | ✅ | ✅ | ✅ | ✅ |

### Checkout and build artifacts

Change where inputs come from without changing actions; publish outputs separately.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Checkout from local files or Git](./examples/source-providers) | — | ✅ | — | — |
| [Checkout from GitLab](./examples/gitlab-source) | — | ✅ | ✅ | ✅ |
| [Checkout from R2](./examples/r2-source) | 🔜 | ✅ | ✅ | ✅ |
| [Checkout from Cloudflare Artifacts](./examples/artifacts-source) | — | ✅ | ✅ | ✅ |
| [Checkout from a Durable Object](./examples/durable-object-source) | 🔜 | ✅ | ✅ | ✅ |
| [Share build artifacts between jobs](./examples/portable-artifacts) | ✅ | ✅ | ✅ | ✅ |

### Runners and execution tiers

Choose where the same program runs, from local containers to durable Workflows and isolates.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run CI in a local container](./examples/local-container) | ✅ | ✅ | ✅ | — |
| [Resume CI steps on Cloudflare](./examples/cloudflare-runner) | ✅ | ✅ | ✅ | ✅ |
| [Choose where CI runs](./examples/runner-selection) | ✅ | ✅ | ✅ | — |
| [Run CI on Blacksmith](./examples/blacksmith) | 🔜 | ✅ | 🔜 | — |
| [Format code without a container](./examples/dynamic-worker-checks) | ✅ | ✅ | ✅ | ✅ · containerless |
| [Test untrusted code without a container](./examples/dynamic-project-checks) | — | ✅ | — | ✅ · containerless |

### Toolchains and container images

Select runtimes and OS tools before adding a custom image. A runner image is not a project image.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Choose a Node.js version](./examples/node-version) | ✅ | ✅ | ✅ | ✅ |
| [Install runtimes with Mise](./examples/mise-toolchain) | ✅ | ✅ | ✅ | ✅ |
| [Install system tools](./examples/system-package) | ✅ | ✅ | ✅ | ✅ |
| [Install Python on Cloudflare](./examples/cloudflare-toolchain) | ✅ | ✅ | ✅ | ✅ |
| [Customize the CI container](./examples/custom-runner-image) | — | ✅ | — | ✅ |
| [Build and run Docker in CI](./examples/docker-in-docker) | — | 🔜 | — | 🔜 |
| [Build and publish a container image](./examples/custom-container-image) | ✅ | ✅ | ✅ | 🔜 |

### Control flow and recovery

Add inspectable routing, parallel checks, retry policy, and compensation one at a time.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Deploy only on matching branches or events](./examples/conditional-deploy) | ✅ | ✅ | ✅ | ✅ |
| [Deploy only changed build output](./examples/deploy-changed-output) | 🔜 | ✅ | — | 🔜 |
| Run a group of actions only when a condition matches | 🔜 | 🔜 | 🔜 | 🔜 |
| [Trigger CI from a deployment hook](./examples/deploy-hook) | ✅ | ✅ | ✅ | ✅ |
| [Run required and optional checks](./examples/optional-checks) | ✅ | ✅ | ✅ | ✅ |
| [Run checks in parallel from one workspace](./examples/snapshot-fanout) | ✅ | ✅ | ✅ | ✅ |
| [Set retry and timeout limits](./examples/execution-policy) | ✅ | ✅ | ✅ | ✅ |
| [Retry a flaky test](./examples/retry) | — | ✅ | ✅ | ✅ |
| [Roll back after a failed action](./examples/rollback-compensation) | ✅ | ✅ | ✅ | ✅ |

### Caching, reruns, and verification

Keep download caches, task caches, workspace checkpoints, and signed commit evidence distinct.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Cache dependency downloads](./examples/package-manager-cache) | ✅ | ✅ | ✅ | ✅ |
| [Cache tasks with Vite+](./examples/vite-plus-cache) | ✅ | ✅ | ✅ | ✅ |
| [Cache tasks with Turborepo](./examples/turborepo-cache) | ✅ | ✅ | ✅ | ✅ |
| [Customize or disable caching](./examples/cache-policy) | ✅ | ✅ | ✅ | ✅ |
| [Reuse verified checks for a commit](./examples/verification-evidence) | 🔜 | ✅ | ✅ | 🔜 |
| [Rerun only affected checks](./examples/dependency-aware-reruns) | 🔜 | ✅ | 🔜 | 🔜 |
| [Keep rerun history and reuse passed steps](./examples/immutable-attempts) | 🔜 | ✅ | 🔜 | 🔜 |

### Secrets and outbound authentication

Keep credentials outside workspace containers, including authenticated outbound requests.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Use secrets without exposing them to containers](./examples/secure-secrets) | ✅ | ✅ | ✅ | ✅ |
| [Call authenticated APIs without exposing credentials](./examples/secret-outbound) | — | 🔜 | — | ✅ |

### Hosted CI, notifications, and approvals

Integration recipes compose the earlier ingredients. Notification channels are not separate build pipelines.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run GitHub CI on Cloudflare](./examples/github-cloudflare-ci) ([deploy service](./apps/effect-ci)) | — | — | — | ✅ |
| [Run CI remotely from the CLI](./examples/cloudflare-hitl-release) | — | — | — | ✅ |
| [Approve a deployment in GitHub](./examples/hitl-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Approve a release in Slack](./examples/cloudflare-hitl-release) | — | — | — | ✅ |
| [Request release approval in Discord](./examples/cloudflare-hitl-release) | — | — | — | 🔜 |

### Deployment and progressive release

Start with ordering and migrations, then study health gates and opt-in human review.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| Deploy an app to Cloudflare Workers | 🔜 | 🔜 | 🔜 | 🔜 |
| [Build or publish static files without a container](./examples/static-assets-source) | — | 🔜 | — | ✅ · containerless |
| [Build and serve a static site without a container](./examples/containerless-site) | — | 🔜 | — | ✅ · containerless |
| [Deploy apps in dependency order](./examples/ordered-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Migrate D1 before deploying a Worker](./examples/d1-migration) | 🔜 | ✅ | 🔜 | 🔜 |
| [Recover from a deploy failure after migration](./examples/d1-migration#rollback-is-not-filesystem-rewind) | 🔜 | ✅ | 🔜 | 🔜 |
| [Roll out a Worker with health checks](./examples/health-mediated-release) | 🔜 | 🔜 | 🔜 | 🔜 |
| [Review a rollout when health is uncertain](./examples/health-mediated-approval) | — | 🔜 | — | 🔜 |
| Deploy monorepo apps in dependency order | 🔜 | 🔜 | 🔜 | 🔜 |
| Manage multiple Workers and their settings as code | 🔜 | 🔜 | 🔜 | 🔜 |
| Keep a long-running rollout on compatible code | 🔜 | 🔜 | 🔜 | 🔜 |
| Create and clean up PR preview deployments | 🔜 | 🔜 | 🔜 | 🔜 |

### Diagnosis and repair

Inspect an existing verified Flue repair, then distinguish it from automatic healing.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Inspect a verified Flue repair proposal](./examples/flue-repair) | — | — | — | ✅ |
| Repair, verify, and propose a fix for a failed action | 🔜 | 🔜 | 🔜 | 🔜 |
| Route a Cloudflare observability issue into a self-healing workflow | — | 🔜 | — | 🔜 |

## Evidence boundaries

- The demo's Cloudflare cell covers the enrolled hosted program. It does not prove
  arbitrary uploaded workflow execution. [Actual runs](./apps/effect-ci/TRUSTED-REMOTE.md).
- [Artifacts source proof](./examples/artifacts-source/README.md#verification)
  includes a private repository-root fixture, revoked upload tokens and anonymous
  Git rejection. It is Artifacts upload/binding proof, not private GitHub remote import.
- Containerless recipes verify bounded formatting, project ESM and static-site
  paths separately. They do not imply full Vite+, native binaries or arbitrary
  lifecycle scripts can run in an isolate. Credentials stay in fixed-target brokers.
- The demo's [HTTP error → verified unmerged PR](./apps/effect-ci/PUBLIC-REPAIR.md)
  is recorded separately from the still-unverified WOBS recipe above. No repair
  is automatically merged or deployed.
- Slack's reviewed release proof is not strict healthy automatic progression.
  Uncertain health needs a decision; rejection or timeout restores the prior allocation.
- Setup guides are not verified one-click installers. Use each app's documented
  Access, App and secret setup; do not deploy the whole repository blindly.

## Next

[Cross-merge verification](https://github.com/ericclemmons/effect-ci-testbed/issues/229) ·
[Automatic DAG scheduling](https://github.com/ericclemmons/effect-ci-testbed/issues/171) ·
[Same-run video proof](https://github.com/ericclemmons/effect-ci-testbed/issues/165) ·
[Documentation and coverage gaps](https://github.com/ericclemmons/effect-ci-testbed/issues/163)
