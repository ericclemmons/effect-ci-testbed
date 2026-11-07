# Choose a Node.js version

Run CI with the version your project declares.

[Source](./.cloudflare/ci/actions.ts#symbol=installNode "source")

This example uses [`.node-version`](./.node-version). The capability also reads
`.nvmrc` and an exact `package.json#devEngines.runtime` declaration.
`engines.node` describes compatibility, not the selected runtime.

## Run it

With Docker running:

```sh
cd examples/node-version
effect-ci run
```

[Actions](./.cloudflare/ci/actions.ts) · [Multiple runtimes with Mise](../mise-toolchain)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) downloads the Node.js version
in `.node-version` from nodejs.org in a setup step, saves it as a
`step.runner()` output, and restores it into the version check. The managed
image ships Node.js 24. It does not use Effect CI.

```sh
(cd examples/node-version/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs node-version
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
