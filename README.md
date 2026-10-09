# Effect CI testbed

> Experimental prototype. The examples are the product specification.

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
have been exercised. CLI authentication through Access remains a separate validation step.

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

## Examples, in implementation order

The matrix is stack-ranked. Rows marked for conventional GitHub Actions include
comparison YAML alongside the portable Effect CI version. A checkmark means the
use-case is exercised end-to-end in that actual environment. Local `cf dev` counts as
Effect CI Local, not Cloudflare. Cloudflare remains unchecked until the example is
deployed to an account and exercised there. `🔜` is committed roadmap work; `—`
means that execution model is genuinely irrelevant to the use-case.

| Use-case | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run an ordinary npm pipeline](./examples/node-npm) | ✅ | ✅ | ✅ | ✅ |
| [Infer lint, format, check, test, and build from an empty `ci.ts`](./examples/zero-config) | ✅ | ✅ | ✅ | 🔜 |
| [Expose selected actions as direct `cf-ci` targets](./examples/exported-actions) | ✅ | ✅ | ✅ | 🔜 |
| [Swap filesystem and Git source providers without changing the workflow](./examples/source-providers) | — | ✅ | — | — |
| Materialize R2, Durable Object, or artifact sources | 🔜 | 🔜 | 🔜 | 🔜 |
| [Make event and branch conditions inspectable](./examples/conditional-deploy) | ✅ | ✅ | ✅ | ✅ |
| Route an inspectable condition over a whole action subgraph | 🔜 | 🔜 | 🔜 | 🔜 |
| [Route deployment lifecycle hooks into an inspectable workflow branch](./examples/deploy-hook) | 🔜 | ✅ | ✅ | 🔜 |
| [Apply retries and timeouts consistently](./examples/execution-policy) | ✅ | ✅ | ✅ | 🔜 |
| [Run required and optional checks in parallel](./examples/optional-checks) | ✅ | ✅ | ✅ | ✅ |
| [Roll back actions only after retries are exhausted](./examples/rollback-compensation) | ✅ | ✅ | ✅ | 🔜 |
| [Run local CI in an isolated container](./examples/local-container) | ✅ | ✅ | ✅ | — |
| [Use pnpm without changing the workflow shape](./examples/node-pnpm) | ✅ | ✅ | ✅ | ✅ |
| [Require GitHub approval before production deployment](./examples/hitl-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Restore a workspace between durable Cloudflare steps](./examples/cloudflare-runner) | ✅ | ✅ | ✅ | ✅ |
| [Install Python at runtime without a project-specific image](./examples/cloudflare-toolchain) | ✅ | ✅ | ✅ | ✅ |
| [Customize the Cloudflare runner with a project Dockerfile](./examples/custom-runner-image) | — | ✅ | — | 🔜 |
| [Build and run a user-provided Dockerfile inside a Cloudflare Sandbox](./examples/docker-in-docker) | — | 🔜 | — | 🔜 |
| [Run GitHub-source CI on Cloudflare and report checks back](./examples/github-cloudflare-ci) ([deploy service](./apps/effect-ci)) | — | — | — | ✅ |
| [Trigger a remote Workflow with `cf-ci --remote` and follow its native events](./examples/cloudflare-hitl-release) | — | — | — | 🔜 |
| [Choose GitHub-hosted, Blacksmith, or self-hosted compute](./examples/runner-selection) | ✅ | ✅ | ✅ | — |
| [Run source-only checks outside the workspace container](./examples/dynamic-worker-checks) | ✅ | ✅ | ✅ | 🔜 |
| [Infer task inputs and outputs automatically with Vite+](./examples/vite-plus-cache) | ✅ | ✅ | ✅ | 🔜 |
| [Reuse Turborepo's local or remote task cache](./examples/turborepo-cache) | ✅ | ✅ | ✅ | 🔜 |
| [Reuse package-manager downloads without replacing the workspace](./examples/package-manager-cache) | ✅ | ✅ | ✅ | ✅ |
| [Install all runtimes declared by Mise](./examples/mise-toolchain) | ✅ | ✅ | ✅ | 🔜 |
| [Select and cache a project-specific Node.js version](./examples/node-version) | ✅ | ✅ | ✅ | 🔜 |
| [Install a system dependency such as ImageMagick](./examples/system-package) | ✅ | ✅ | ✅ | ✅ |
| [Customize cache keys, paths, invalidation, or disable caching](./examples/cache-policy) | ✅ | ✅ | ✅ | 🔜 |
| [Fan one prepared snapshot out to isolated parallel checks](./examples/snapshot-fanout) | ✅ | ✅ | 🔜 | 🔜 |
| [Select only the dependency-affected rerun subgraph](./examples/dependency-aware-reruns) | 🔜 | ✅ | 🔜 | 🔜 |
| [Preserve immutable attempts and reuse unaffected checkpoints](./examples/immutable-attempts) | 🔜 | ✅ | 🔜 | 🔜 |
| [Resolve secrets without putting them in containers](./examples/secure-secrets) | ✅ | ✅ | ✅ | 🔜 |
| [Publish and restore portable build artifacts](./examples/portable-artifacts) | ✅ | ✅ | ✅ | 🔜 |
| [Reuse signed evidence for side-effect-free checks](./examples/verification-evidence) | 🔜 | ✅ | ✅ | 🔜 |
| [Pause and durably resume a release from a protected review page](./examples/cloudflare-hitl-release) | — | — | — | 🔜 |
| [Send a Discord approval notification for a waiting release](./examples/cloudflare-hitl-release) | — | — | — | 🔜 |
| Deploy a built workspace to Cloudflare Workers | 🔜 | 🔜 | 🔜 | 🔜 |
| [Apply a D1 migration before deploying the Worker that requires it](./examples/d1-migration) | 🔜 | ✅ | 🔜 | 🔜 |
| [Recover safely when deployment fails after a database migration](./examples/d1-migration#rollback-is-not-filesystem-rewind) | 🔜 | ✅ | 🔜 | 🔜 |
| [Deploy two dependent applications in an explicit order](./examples/ordered-deploy) | ✅ | ✅ | ✅ | 🔜 |
| Derive a monorepo deployment order from its Turborepo or Vite+ graph | 🔜 | 🔜 | 🔜 | 🔜 |
| Define multiple Workers as code with Cloudflare `defineConfig` and prevent settings drift | 🔜 | 🔜 | 🔜 | 🔜 |
| [Build and publish a custom container image alongside Cloudflare services](./examples/custom-container-image) | ✅ | ✅ | ✅ | 🔜 |
| Pin a compatible Worker version throughout a long external rollout | 🔜 | 🔜 | 🔜 | 🔜 |
| Create and clean up pull-request preview deployments | 🔜 | 🔜 | 🔜 | 🔜 |
| Repair, verify, and propose a fix for a failed action | 🔜 | 🔜 | 🔜 | 🔜 |
| Route a Cloudflare observability issue into a self-healing workflow | — | 🔜 | — | 🔜 |

The Worker-isolate slice is now proven with Prettier: source crosses the workspace
boundary, while formatting executes outside the Container. The larger Dynamic Worker
target remains the complete Vite+ toolchain—Oxlint, Oxfmt, and Vitest—plus untrusted
project modules loaded with explicit capabilities. The architectural goal is broader
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
