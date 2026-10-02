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

The table is stack-ranked. Each linked directory contains a focused README answering
one “How do I…?” question. **Next** is the active product slice; later rows may move as
we learn from it.

| # | Example | Question it answers | Status | Vanilla CI | Effect CI | Cloudflare |
| -: | --- | --- | --- | :---: | :---: | :---: |
| 1 | [`node-npm`](./examples/node-npm) | How do I run npm lint, optional formatting, tests, and a build? | Done | ✅ | ✅ | — |
| 2 | [`node-pnpm`](./examples/node-pnpm) | How does the same workflow use pnpm without changing its shape? | Done | ✅ | ✅ | — |
| 3 | [`hitl-deploy`](./examples/hitl-deploy) | How does a production deploy require build artifacts and human approval? | Done | ✅ | ✅ | — |
| 4 | [`cloudflare-runner`](./examples/cloudflare-runner) | How do I run CI in a Cloudflare Workflow and restore a Container snapshot? | Done | — | ✅ | ✅ |
| 5 | [`cloudflare-toolchain`](./examples/cloudflare-toolchain) | How do I prepare and snapshot extra tools without a Dockerfile? | Done | — | ✅ | ✅ |
| 6 | [`github-cloudflare-ci`](./examples/github-cloudflare-ci) | How does GitHub remain the source while Cloudflare runs all CI and reports checks and logs back? | In progress | — | ✅ | ✅ |
| 7 | `github-runner-action` | How does a GitHub job use GitHub-hosted, Blacksmith, or self-hosted compute while a thin action runs the repository's canonical Effect CI program? | Planned | ✅ | ✅ | — |
| 8 | [`vite-plus-cache`](./examples/vite-plus-cache) | How can Effect CI persist Vite+'s automatically tracked task cache between Workflow instances? | Done | — | ✅ | ✅ |
| 9 | [`turborepo-cache`](./examples/turborepo-cache) | How can Effect CI persist Turborepo's task cache between Workflow instances? | Done | — | ✅ | ✅ |
| 10 | `package-manager-cache` | How does installation restore package-manager-owned cache paths without replacing the incoming workspace? | Next | — | ✅ | ✅ |
| 11 | `mise-toolchain` | How does a project install all runtimes declared by Mise before resolving its package managers? | Planned | — | ✅ | ✅ |
| 12 | `node-version` | How does a project select and cache a Node.js version that is absent from the runner image? | Planned | — | ✅ | ✅ |
| 13 | `system-packages` | How does a build install an uncommon system dependency such as ImageMagick across runner images? | Planned | — | ✅ | ✅ |
| 14 | `custom-cache` | How does a project change cache keys, paths, scope, retention, or disable caching without changing its actions? | Planned | — | ✅ | ✅ |
| 15 | `cloudflare-parallel` | How does one prepared snapshot fan out into parallel lint, test, and build Containers? | Planned | — | ✅ | ✅ |
| 16 | `cloudflare-approval` | How does a Cloudflare Workflow pause for approval and durably resume the same deployment? | Planned | — | ✅ | ✅ |
| 17 | `chat-approval` | How does Slack or Discord resolve the same portable approval request? | Planned | — | ✅ | ✅ |
| 18 | `workers-deploy` | How does a built workspace become a Cloudflare Workers deployment? | Planned | ✅ | ✅ | ✅ |
| 19 | `workers-preview` | How are pull-request previews created, reported, and cleaned up? | Planned | ✅ | ✅ | ✅ |
| 20 | `agent-healing` | How does a failed action invoke a specialized repair, verify it, and propose or publish the fix? | Planned | — | ✅ | ✅ |

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
