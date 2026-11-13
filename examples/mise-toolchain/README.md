# Install runtimes with Mise

Use the Node and Python versions already declared in `mise.toml`.

Later commands use `mise.exec(...)`, so no shell activation is needed.
Tool downloads live under `.effect-ci/cache/mise`.

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with your mise.toml

Use your project's existing `mise.toml`:

[`mise.toml`](./mise.toml "source")

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import and checkout:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Install every tool in `mise.toml`:

[Install toolchain](./.cloudflare/ci/actions.ts#symbol=installToolchain "source {3,5}")

Run commands through `mise.exec(...)` so they use the installed versions. This
example checks the exact Node and Python versions:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=verifyNode "source 'mise.exec'")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=verifyPython "source 'mise.exec'")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Local runs use the official mise image in a
[local container](../local-container):

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {12-15}")

## Run it

With Docker running:

```sh
cd examples/mise-toolchain
effect-ci run
```

## Compare with GitHub Actions

The same checks with `jdx/mise-action`:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L18 "source")

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) installs mise and the tools
in `mise.toml` under `/workspace` in a setup step, saves them as an output, and
restores them into parallel Node.js and Python version checks. It does not use
Effect CI.

```sh
(cd examples/mise-toolchain/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs mise-toolchain
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
