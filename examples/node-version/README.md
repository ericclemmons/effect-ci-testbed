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
