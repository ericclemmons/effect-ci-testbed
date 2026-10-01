# Effect CI testbed

> Experimental prototype. The examples are the product specification.

Effect CI authors a pipeline once in TypeScript and runs that same program locally,
on a GitHub runner, or in a Cloudflare Workflow. Actions own their required
dependencies; workflows coordinate sequencing, parallelism, optional work, recovery,
approval, and deployment.

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
| 6 | [`github-cloudflare-ci`](./examples/github-cloudflare-ci) | How does GitHub remain the source while Cloudflare runs all CI and reports checks and logs back? | **Next** | — | ✅ | ✅ |
| 7 | `package-manager-cache` | How are detected npm, pnpm, and other package-manager caches restored automatically? | Planned | — | ✅ | ✅ |
| 8 | `vite-plus-cache` | How can a tool publish cache metadata that Effect CI uses automatically? | Planned | — | ✅ | ✅ |
| 9 | `cloudflare-parallel` | How does one prepared snapshot fan out into parallel lint, test, and build Containers? | Planned | — | ✅ | ✅ |
| 10 | `workers-deploy` | How do typed build artifacts become a Cloudflare Workers deployment? | Planned | ✅ | ✅ | ✅ |
| 11 | `workers-preview` | How are pull-request previews created, reported, and cleaned up? | Planned | ✅ | ✅ | ✅ |
| 12 | `agent-healing` | How does a failed action invoke a specialized repair, verify it, and propose or publish the fix? | Planned | — | ✅ | ✅ |

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
