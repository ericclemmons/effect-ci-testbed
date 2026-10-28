# Effect CI

> **PROTOTYPE — NOT A CI SERVICE.** Eric Clemmons's laboratory for trying CI ideas.
> APIs, commands, and stored data can change. Use disposable projects, not production workloads.

[Walkthrough](./examples/demo/README.md) · [Ecosystem](./examples/ECOSYSTEM.md) ·
[Recipes](./examples/README.md) · [API reference](./packages/ci/README.md)

## Features

✅ = implemented prototype path. It does not mean verified on every host.
[Execution evidence](./examples/COVERAGE.md) records the narrower environment checks.

| | Try it | Limit |
| --- | --- | --- |
| ✅ Existing package scripts | [Run without a workflow](./examples/zero-config) | Conventional Node script names; no automatic task caching. |
| ✅ Human and agent output | [Text, JSON, and Mermaid](./examples/demo/README.md#3-inspect-before-running) | Same commands; detected agents get JSON. |
| ✅ Local and remote execution | [Choose where checks run](./examples/demo/README.md#6-run-on-a-host) | Remote needs an enrolled host and a pushed commit. |
| ✅ Task caching | [Vite+](./examples/vite-plus-cache) · [Turborepo](./examples/turborepo-cache) | The task runner tracks inputs; Effect CI does not infer them. |
| ✅ Signed check reuse | [Reuse verified checks](./examples/verification-evidence) | Exact commit, trusted signer, eligible check. Not arbitrary local results. |
| ✅ Shared prerequisites and parallel work | [Exported actions](./examples/exported-actions) · [Isolated fan-out](./examples/snapshot-fanout) | Parallelism is explicit. |
| ✅ GitHub checks | [GitHub](./examples/GITHUB.md) | Requires an installed App and host enrollment. |
| ✅ Change-aware approval | [Approve safe changes](./examples/small-change) | Approval is not an automatic merge. |
| ✅ Credentials outside workloads | [Outbound authentication](./examples/secret-outbound) · [OIDC](./examples/oidc-cf) | The trusted host owns permissions. |
| ✅ Previews and controlled releases | [Release recipes](./examples/README.md#control-failures-and-releases) | Each recipe has its own setup and evidence. |
| ✅ Repair experiments | [Propose a fix](./examples/flue-repair) | Opt-in; not part of the walkthrough. |

No speed or feature-parity claims. Compare the runnable examples, not the checkmarks.

## Try it locally

Node 24.11+ or Node 26+, pnpm, and Git. The CLI is unpublished; use this checkout:

```sh
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
effect-ci --help
```

[Start the walkthrough](./examples/demo/README.md) in a separate, disposable repository.
No Cloudflare account, GitHub connection, or deployment credentials needed for the local steps.

## Reference

[CLI](./packages/cli/README.md) · [SDK](./packages/ci/README.md) ·
[Self-hosting](./apps/effect-ci/README.md) · [Repository wiring](./apps/docs/LABORATORY.md) ·
[Documentation authoring](./apps/docs/README.md)
