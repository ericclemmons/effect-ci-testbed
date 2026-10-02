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

## Examples, in implementation order

The matrix is stack-ranked. Each link opens one focused example that answers the stated
use-case. Checkmarks mean that execution path is exercised; blank cells are useful gaps,
not a separate status system.

| Use-case | Local | GitHub | Cloudflare |
| --- | :---: | :---: | :---: |
| [Run required and optional npm checks](./examples/node-npm) | ✅ | ✅ | |
| [Use pnpm without changing the workflow shape](./examples/node-pnpm) | ✅ | ✅ | |
| [Require GitHub approval before production deployment](./examples/hitl-deploy) | ✅ | ✅ | |
| [Restore a workspace between durable Cloudflare steps](./examples/cloudflare-runner) | ✅ | | ✅ |
| [Install and snapshot tools without a Dockerfile](./examples/cloudflare-toolchain) | ✅ | | ✅ |
| [Run GitHub-source CI on Cloudflare and report checks back](./examples/github-cloudflare-ci) | ✅ | ✅ | ✅ |
| Run the canonical CI script on GitHub-hosted, Blacksmith, or self-hosted compute | | | |
| [Reuse Vite+'s task cache](./examples/vite-plus-cache) | ✅ | | ✅ |
| [Reuse Turborepo's task cache](./examples/turborepo-cache) | ✅ | | ✅ |
| [Reuse package-manager downloads without replacing the workspace](./examples/package-manager-cache) | ✅ | | ✅ |
| Install all runtimes declared by Mise | | | |
| Select and cache a project-specific Node.js version | | | |
| Install a system dependency such as ImageMagick | | | |
| Customize cache keys, paths, scope, retention, or disable caching | | | |
| Fan one prepared snapshot out to parallel Containers | | | |
| Pause and durably resume a Cloudflare Workflow for approval | | | |
| Resolve an approval request from Slack or Discord | | | |
| Deploy a built workspace to Cloudflare Workers | | | |
| Create and clean up pull-request preview deployments | | | |
| Repair, verify, and propose a fix for a failed action | | | |

## Try it locally

```sh
pnpm install

# Discover the graph without executing it.
./examples/node-npm/.cloudflare/workflows/ci.run.ts plan

# List or run one exported action for an agent or developer.
./examples/node-npm/.cloudflare/workflows/ci.run.ts list
./examples/node-npm/.cloudflare/workflows/ci.run.ts run lint --format=json

# Run the repository workflow and type-check the testbed.
./examples/node-npm/.cloudflare/workflows/ci.run.ts
pnpm check
```
