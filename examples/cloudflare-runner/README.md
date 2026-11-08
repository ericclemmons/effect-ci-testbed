# Resume CI steps on Cloudflare

Run checkout, install, and build as durable actions without handling snapshot IDs.

An action returns its updated workspace:

[Source](./.cloudflare/ci/actions.ts#symbol=build "source")

The Cloudflare runner checkpoints that workspace and restores it after suspension
or container eviction. This example disables live reuse so every consumer restores
its prerequisite's saved revision.

## Try it

Run the portable workflow locally:

```sh
cd examples/cloudflare-runner
effect-ci run
```

For native execution, follow the [host setup](../../apps/effect-ci/SELF-HOST.md).
[Worker adapter](./src/worker.ts) · [Actions](./.cloudflare/ci/actions.ts)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs `npm ci` and `npm run
build` in `app/` as two durable steps. It does not use Effect CI.

```sh
(cd examples/cloudflare-runner/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs cloudflare-runner
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
