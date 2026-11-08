# Install runtimes with Mise

Use the Node and Python versions already declared in [mise.toml](./mise.toml).

[Source](./.cloudflare/ci/actions.ts#symbol=installToolchain "source")

Later commands use `mise.exec(...)`, so no shell activation is needed.
Tool downloads live under `.effect-ci/cache/mise`.

## Run it

With Docker running:

```sh
cd examples/mise-toolchain
effect-ci run
```

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)

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
