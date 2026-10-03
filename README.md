# Effect CI testbed

> Experimental prototype. The examples are the product specification.

Effect CI authors a pipeline once in TypeScript and runs that same program locally,
on compute selected by a GitHub job, or in a Cloudflare Workflow. Actions own their required
dependencies; workflows coordinate sequencing, parallelism, optional work, recovery,
approval, and deployment.

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
- Retry and timeout policy lives on an action and is lowered by the runner: Effect
  handles it locally, while Cloudflare receives native `step.do` options.
- `CI.when` is the small, serializable condition algebra for branches operators must
  inspect. Ordinary Effect control flow remains available for runtime-only decisions.
- `CI.compensate` is terminal recovery after retries, not a retry or filesystem rewind.
- `CI.Secret` returns a redacted host-side capability; `CI.Artifact` publishes a
  runner-owned checkpoint only when output must cross a workload boundary.
- Side-effect-free checks may opt into signed commit evidence. A runner verifies exact
  inputs and signatures; missing or invalid evidence always falls back to execution.

## Examples, in implementation order

The matrix is stack-ranked. Rows marked for conventional GitHub Actions include
comparison YAML alongside the portable Effect CI version. A checkmark means the
use-case is exercised end-to-end in that actual environment. `wrangler dev --local` counts as
Effect CI Local, not Cloudflare. Cloudflare remains unchecked until the example is
deployed to an account and exercised there. `🔜` is committed roadmap work; `—`
means that execution model is genuinely irrelevant to the use-case.

| Use-case | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run an ordinary npm pipeline](./examples/node-npm) | ✅ | ✅ | ✅ | 🔜 |
| [Make event and branch conditions inspectable](./examples/conditional-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Apply retries and timeouts consistently](./examples/execution-policy) | ✅ | ✅ | ✅ | 🔜 |
| [Run required and optional checks in parallel](./examples/optional-checks) | ✅ | ✅ | ✅ | 🔜 |
| [Compensate only after retries are exhausted](./examples/rollback-compensation) | ✅ | ✅ | ✅ | 🔜 |
| [Run local CI in an isolated container](./examples/local-container) | ✅ | ✅ | ✅ | — |
| [Use pnpm without changing the workflow shape](./examples/node-pnpm) | ✅ | ✅ | ✅ | 🔜 |
| [Require GitHub approval before production deployment](./examples/hitl-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Restore a workspace between durable Cloudflare steps](./examples/cloudflare-runner) | ✅ | ✅ | ✅ | 🔜 |
| [Install and snapshot tools without a Dockerfile](./examples/cloudflare-toolchain) | ✅ | ✅ | ✅ | 🔜 |
| [Run GitHub-source CI on Cloudflare and report checks back](./examples/github-cloudflare-ci) | — | — | — | 🔜 |
| [Choose GitHub-hosted, Blacksmith, or self-hosted compute](./examples/runner-selection) | ✅ | ✅ | ✅ | — |
| [Reuse Vite+'s task cache](./examples/vite-plus-cache) | ✅ | ✅ | ✅ | 🔜 |
| [Reuse Turborepo's task cache](./examples/turborepo-cache) | ✅ | ✅ | ✅ | 🔜 |
| [Reuse package-manager downloads without replacing the workspace](./examples/package-manager-cache) | ✅ | ✅ | ✅ | 🔜 |
| [Install all runtimes declared by Mise](./examples/mise-toolchain) | ✅ | ✅ | ✅ | 🔜 |
| [Select and cache a project-specific Node.js version](./examples/node-version) | ✅ | ✅ | ✅ | 🔜 |
| [Install a system dependency such as ImageMagick](./examples/system-package) | ✅ | ✅ | ✅ | 🔜 |
| [Customize cache keys, paths, invalidation, or disable caching](./examples/cache-policy) | ✅ | ✅ | ✅ | 🔜 |
| [Fan one prepared snapshot out to isolated parallel checks](./examples/snapshot-fanout) | ✅ | ✅ | 🔜 | 🔜 |
| [Select only the dependency-affected rerun subgraph](./examples/dependency-aware-reruns) | 🔜 | ✅ | 🔜 | 🔜 |
| [Preserve immutable attempts and reuse unaffected checkpoints](./examples/immutable-attempts) | 🔜 | ✅ | 🔜 | 🔜 |
| [Resolve secrets without putting them in containers](./examples/secure-secrets) | ✅ | ✅ | ✅ | 🔜 |
| [Publish and restore portable build artifacts](./examples/portable-artifacts) | ✅ | ✅ | ✅ | 🔜 |
| [Reuse signed evidence for side-effect-free checks](./examples/verification-evidence) | 🔜 | ✅ | ✅ | 🔜 |
| Pause and durably resume a Cloudflare Workflow for approval | — | 🔜 | — | 🔜 |
| Resolve an approval request from Slack or Discord | 🔜 | 🔜 | 🔜 | 🔜 |
| Deploy a built workspace to Cloudflare Workers | 🔜 | 🔜 | 🔜 | 🔜 |
| [Apply a D1 migration before deploying the Worker that requires it](./examples/d1-migration) | ✅ | ✅ | ✅ | 🔜 |
| [Recover safely when deployment fails after a database migration](./examples/d1-migration#rollback-is-compensation-not-rewind) | ✅ | ✅ | ✅ | 🔜 |
| [Deploy two dependent applications in an explicit order](./examples/ordered-deploy) | ✅ | ✅ | ✅ | 🔜 |
| Derive a monorepo deployment order from its Turborepo or Vite+ graph | 🔜 | 🔜 | 🔜 | 🔜 |
| Define multiple Workers as code with Cloudflare `defineConfig` and prevent settings drift | 🔜 | 🔜 | 🔜 | 🔜 |
| [Build and publish a custom container image alongside Cloudflare services](./examples/custom-container-image) | ✅ | ✅ | ✅ | 🔜 |
| Pin a compatible Worker version throughout a long external rollout | 🔜 | 🔜 | 🔜 | 🔜 |
| Create and clean up pull-request preview deployments | 🔜 | 🔜 | 🔜 | 🔜 |
| Repair, verify, and propose a fix for a failed action | 🔜 | 🔜 | 🔜 | 🔜 |

## Try it locally

```sh
pnpm install

# Discover the graph without executing it.
./examples/node-npm/.cloudflare/ci/workflow.ts plan

# List or run one exported action for an agent or developer.
./examples/node-npm/.cloudflare/ci/workflow.ts list
./examples/node-npm/.cloudflare/ci/workflow.ts run lint --format=json

# Run the repository workflow and type-check the testbed.
./examples/node-npm/.cloudflare/ci/workflow.ts
pnpm check
```
