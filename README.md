# Effect CI

> **Prototype.** I'm using this to try out CI ideas.

[Walkthrough](./examples/demo/README.md) · [Ecosystem](./examples/ECOSYSTEM.md) ·
[Recipes](./examples/README.md) · [API reference](./packages/ci/README.md)

## Features

| Feature | Try it |
| --- | --- |
| ✅ Existing package scripts | [Run without a workflow](./examples/zero-config) |
| ✅ Human and agent output | [Text, JSON, and Mermaid](./examples/demo/README.md#3-inspect-before-running) |
| ✅ Local and remote execution | [Choose where checks run](./examples/demo/README.md#6-run-on-a-host) |
| ✅ Task caching | [Vite+](./examples/vite-plus-cache) · [Turborepo](./examples/turborepo-cache) |
| ✅ Signed check reuse | [Reuse verified checks](./examples/verification-evidence) |
| ✅ Shared prerequisites and parallel work | [Exported actions](./examples/exported-actions) · [Isolated fan-out](./examples/snapshot-fanout) |
| ✅ GitHub checks | [GitHub](./examples/GITHUB.md) |
| ✅ Change-aware approval | [Approve safe changes](./examples/small-change) |
| ✅ Credentials outside workloads | [Outbound authentication](./examples/secret-outbound) · [OIDC](./examples/oidc-cf) |
| ✅ Previews and controlled releases | [Release recipes](./examples/README.md#control-failures-and-releases) |
| ✅ Repair experiments | [Propose a fix](./examples/flue-repair) |

## Try it locally

Node 24.11+ or 26+, pnpm, and Git. From a clone of this repository:

```sh
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
effect-ci --help
```

[Start the walkthrough](./examples/demo/README.md). No accounts needed for the local steps.

## Reference

[CLI](./packages/cli/README.md) · [SDK](./packages/ci/README.md) ·
[Self-hosting](./apps/effect-ci/README.md) · [Repository wiring](./apps/docs/LABORATORY.md) ·
[Execution evidence](./examples/COVERAGE.md) · [Documentation authoring](./apps/docs/README.md)
