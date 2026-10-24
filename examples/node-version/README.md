# Choose a Node.js version

Run CI with the version your project declares.

[Source](./.cloudflare/ci/actions.ts#symbol=installNode "source")

This example uses [`.node-version`](./.node-version). The capability also reads
`.nvmrc` and an exact `package.json#devEngines.runtime` declaration.
`engines.node` describes compatibility, not the selected runtime.

## Run it

With Docker running:

```sh
pnpm exec cf-ci run --workflow examples/node-version/.cloudflare/ci/workflow.ts
```

[Actions](./.cloudflare/ci/actions.ts) · [Multiple runtimes with Mise](../mise-toolchain)
