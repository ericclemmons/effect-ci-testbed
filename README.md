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

## Examples, in implementation order

The matrix is stack-ranked. Each implemented example compares conventional GitHub
Actions YAML with the portable Effect CI version. A checkmark means the use-case is
exercised end-to-end in that actual environment. `wrangler dev --local` counts as
Effect CI Local, not Cloudflare. Cloudflare remains unchecked until the example is
deployed to an account and exercised there. `🔜` is committed roadmap work; `—`
means that execution model is genuinely irrelevant to the use-case.

| Use-case | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run an ordinary npm pipeline](./examples/node-npm) | ✅ | ✅ | ✅ | 🔜 |
| [Run required and optional checks in parallel](./examples/optional-checks) | ✅ | ✅ | ✅ | 🔜 |
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
| Install all runtimes declared by Mise | 🔜 | 🔜 | 🔜 | 🔜 |
| Select and cache a project-specific Node.js version | 🔜 | 🔜 | 🔜 | 🔜 |
| Install a system dependency such as ImageMagick | 🔜 | 🔜 | 🔜 | 🔜 |
| Customize cache keys, paths, scope, retention, or disable caching | 🔜 | 🔜 | 🔜 | 🔜 |
| Fan one prepared snapshot out to parallel Containers | — | 🔜 | — | 🔜 |
| [Select only the dependency-affected rerun subgraph](./examples/dependency-aware-reruns) | 🔜 | ✅ | 🔜 | 🔜 |
| Preserve immutable attempts and reuse unaffected checkpoints | 🔜 | 🔜 | 🔜 | 🔜 |
| Pause and durably resume a Cloudflare Workflow for approval | — | 🔜 | — | 🔜 |
| Resolve an approval request from Slack or Discord | 🔜 | 🔜 | 🔜 | 🔜 |
| Deploy a built workspace to Cloudflare Workers | 🔜 | 🔜 | 🔜 | 🔜 |
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
