<img src="./apps/effect-ci/assets/bolt-stack.svg" alt="Effect CI layered lightning logo" width="96" height="96">

# Effect CI testbed

> Experimental prototype. The examples are the product specification.

**CI isn't a pipeline. It's a flywheel.** Run checks, retain trustworthy evidence,
release deliberately, observe what happens, and use failures to propose verified
repairs. This testbed asks an agent to prove those customer needs with standalone
recipes—not to declare an entire CI product finished.

## Try it locally

Use Node 24.11+ or Node 26+ and the repository's pnpm version. From a clone:

```sh
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
cd examples/developer-loop
cf-ci list --format=text
cf-ci plan --format=mermaid
cf-ci run lint --format=text
cf-ci run build --format=text
```

The example already contains an empty workflow marker. Its package scripts are
discovered automatically; the CLI does **not yet create that marker for you**.
Run the build again to inspect Vite+ task reuse, then change source to check
invalidation. A cache hit is not signed verification evidence, and a small cached
task is not necessarily faster than executing it. Follow the
[developer walkthrough](./examples/developer-loop/TALKING-SCRIPT.md) for expected
results and intentional failures.

Want to move from GitHub to Cloudflare Artifacts **without rewriting CI**? Choose
a different Source adapter while preserving the actions. Want hosted execution?
Use the [Cloudflare app setup](./apps/effect-ci/README.md); `--remote` dispatches the
configured hosted workflow, not arbitrary local code. Trusted exact-commit reuse
is a separate capability—not a promise that remote runs, pushes, builds or
deployments become no-ops.

Each recipe includes an execution plan and a **Verification proof** section.
Videos and measured results remain explicitly pending until actual E2E runs
produce them. The [proof-page contract](./examples/PROOF-PAGES.md) defines what
future agents must record. Existing coverage evidence stays valid; missing video
does not erase it. Observability-driven repair and full GitLab runner parity are
roadmap work, not completed features.

## Execution model

Effect CI is an agent-first execution and verification layer. It runs one pipeline
locally, in the background on compute selected by a GitHub job, or in a Cloudflare
Workflow, and aims to avoid repeating work already proven for the same inputs. Actions
own their required dependencies; workflows coordinate sequencing, parallelism,
optional work, recovery, approval, and deployment.

The consumer model is intentionally small:

- An action returns the next logical `CI.Workspace` by default. The runner checkpoints
  that revision; a non-workspace result must be explicit, such as `CI.action<void>`.
- Capabilities such as `CI.PackageManager.JavaScript(workspace)` remain separate from
  the workspace instead of turning it into a platform-specific god object.
- A durable checkpoint restores one exact action revision. A reusable cache restores
  only its owned paths into the current revision and must never replace dependency
  lineage.
- Runner capabilities are supplied at the entrypoint, not inside the workflow. GitHub
  YAML provides its runner and `actions/cache`; a Cloudflare Worker provides Workflow,
  Container, checkpoint, and snapshot-cache implementations. The same
  `.cloudflare/ci/{actions,workflow}.ts` files import neither platform.
- Event adapters normalize repository and revision into `CI.WorkflowEvent` and provide
  the matching `CI.Source`; `source.checkout()` therefore has no repository path or URL
  argument. Non-source events, such as an observability issue, may omit source entirely
  and route directly to diagnosis or healing actions.
- `CI.Source` is a materialization capability, not a synonym for Git. A runner may
  restore the same logical revision from a local directory, GitHub, R2, a Durable
  Object snapshot, or a previously published artifact. Actions should not know which
  provider satisfied `source.checkout()`.
- Retry and timeout policy lives on an action and is lowered by the runner: Effect
  handles it locally, while Cloudflare receives native `step.do` options.
- `CI.when` is the small, serializable condition algebra for branches operators must
  inspect. Ordinary Effect control flow remains available for runtime-only decisions.
- Actions own rollback behavior; terminal failure unwinds completed actions in reverse order.
- `CI.Secret` returns a redacted host-side capability; `CI.Artifact` publishes a
  runner-owned checkpoint only when output must cross a workload boundary.
- Side-effect-free `CI.check` values return `void` and may opt into runner reuse. A
  `CheckCache` can verify signed commit evidence or a trusted remote-cache hit; missing
  or invalid evidence always falls back to execution.
- Eligible source-only actions should run in lightweight isolates before Effect CI
  escalates to a container. The workflow describes the capability it needs; the runner
  chooses the least expensive compatible execution tier.

Each focused example separates the program from its tests and its platform adapter:

```text
.cloudflare/ci/actions.ts                 reusable action definitions
.cloudflare/ci/workflow.ts                default workflow and intentional public targets
.cloudflare/ci/tests/*.test.ts            ordinary SDK assertions
.github/workflows/github.yml              conventional GitHub Actions comparison
.github/workflows/effect-on-github.yml    the same workflow.ts on a GitHub runner
```

Tests never launch CI. Locally, a developer or agent runs `cf-ci`; the CLI discovers
`.cloudflare/ci/workflow.ts` by walking up from the current directory. On GitHub, the
thin Effect caller passes that same module to the reusable runner. The
conventional YAML is intentionally independent so every example shows the native
GitHub approach beside the portable Effect approach.

## Deployable apps

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
- Running `cf-ci` with no target executes the default workflow using the local event
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
| [Check changes before pushing](./examples/developer-loop) | ✅ | ✅ | ✅ | 🔜 |

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
| [Test untrusted code without a container](./examples/dynamic-project-checks) | — | 🔜 | — | ✅ · containerless |

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
| Run a group of actions only when a condition matches | 🔜 | 🔜 | 🔜 | 🔜 |
| [Trigger CI from a deployment hook](./examples/deploy-hook) | ✅ | ✅ | ✅ | ✅ |
| [Run required and optional checks](./examples/optional-checks) | ✅ | ✅ | ✅ | ✅ |
| [Run checks in parallel from one workspace](./examples/snapshot-fanout) | ✅ | ✅ | 🔜 | ✅ |
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
| Deploy a static site without a build or container | — | 🔜 | — | 🔜 · containerless |
| Build and deploy a static site without a container | — | 🔜 | — | 🔜 · containerless |
| [Deploy apps in dependency order](./examples/ordered-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Migrate D1 before deploying a Worker](./examples/d1-migration) | 🔜 | ✅ | 🔜 | 🔜 |
| [Recover from a deploy failure after migration](./examples/d1-migration#rollback-is-not-filesystem-rewind) | 🔜 | ✅ | 🔜 | 🔜 |
| [Roll out a Worker with health checks](./examples/health-mediated-release) | 🔜 | 🔜 | 🔜 | 🔜 |
| [Review a rollout when health is uncertain](./examples/health-mediated-approval) | — | 🔜 | — | 🔜 |
| Deploy monorepo apps in dependency order | 🔜 | 🔜 | 🔜 | 🔜 |
| Manage multiple Workers and their settings as code | 🔜 | 🔜 | 🔜 | 🔜 |
| Keep a long-running rollout on compatible code | 🔜 | 🔜 | 🔜 | 🔜 |
| Create and clean up PR preview deployments | 🔜 | 🔜 | 🔜 | 🔜 |

The next containerless recipes should build on each other: first retrieve a bounded,
immutable GitHub file manifest, persist it in a DO, and upload existing HTML/CSS/JS;
then add an isolated JS/Wasm build that produces a validated asset manifest. The DO
owns coordination and durable receipts, not an unrestricted shell or project build.
Cloudflare supports [direct static-asset uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/)
through an upload session, missing-asset buckets, and Worker version deployment.
That permits a hosted API adapter; it does not prove that the installed `cf` CLI
runs inside a DO. Its build/deploy process assumes Node tools and filesystem/process
facilities that [Workers do not fully implement](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).
Keep `cf` as the operator entrypoint and share Worker-compatible deployment logic
where available, rather than trying to spawn the CLI in the DO.

For both recipes, deployment credentials stay in a fixed-target trusted broker,
never in the project isolate. Pin source and output digests, bound asset count/size,
reject unsafe paths and redirects, reconcile uncertain upload/deploy acknowledgments,
and verify served content before marking either row complete. A new deployment target
needs its own scoped authority; the HMD demo broker is not a general site deployer.
Arbitrary npm lifecycle scripts, native binaries and framework plugins still need
a container unless their complete build path has a separately proven isolate adapter.

### Diagnosis and repair

Future recipes for responding to failures and observability events.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| Repair, verify, and propose a fix for a failed action | 🔜 | 🔜 | 🔜 | 🔜 |
| Route a Cloudflare observability issue into a self-healing workflow | — | 🔜 | — | 🔜 |

The Dynamic Worker slice is now proven with Prettier: immutable source is fetched
without a Container, and formatting executes through a network-disabled WorkerLoader
isolate. A separate hosted recipe now executes untrusted multi-module project ESM
with host-owned HTTP assertions, empty bindings, denied HTTPS/TCP, fresh globals,
bounded output and prompt CPU-loop rejection. The larger Dynamic Worker
target remains the complete Vite+ toolchain—Oxlint, Oxfmt, and Vitest. The architectural goal is broader
than linting: formatting, tests, builds, and other SDLC work should use an isolate
whenever their declared capabilities permit it, because compute and memory should only
be reserved for a container when the work actually requires one.

Zero-config discovery must still produce an ordinary inspectable plan. The intended
flow is that a minimal `ci.ts` asks Effect CI to infer supported project tasks from
package scripts and known tool manifests; users can then replace or refine any inferred
action. Discovery is an authoring convenience, not a second opaque execution engine.

Running a user's Dockerfile is distinct from customizing the outer runner image.
Cloudflare supports Docker-in-Docker with `docker:dind`; the daemon must disable
iptables and IP forwarding, and networked inner builds or runs use host networking.
That limitation belongs in the runner layer so the portable build action can continue
to say `docker build` without Cloudflare-specific flags.

## Try it locally

Effect CI targets Node.js 24+, which executes the repository's erasable TypeScript
directly. Workflow entrypoints therefore need no `tsx`, `ts-node`, build step, or
custom loader.

```sh
pnpm install

# Discover the graph without executing it.
pnpm cf-ci --workflow examples/node-npm/.cloudflare/ci/workflow.ts plan

# List or run an intentionally exported action for an agent or developer.
pnpm cf-ci --workflow examples/exported-actions/.cloudflare/ci/workflow.ts list
pnpm cf-ci --workflow examples/exported-actions/.cloudflare/ci/workflow.ts run check --format=json

# Run the repository workflow and type-check the testbed.
pnpm cf-ci --workflow examples/node-npm/.cloudflare/ci/workflow.ts
pnpm check
```
