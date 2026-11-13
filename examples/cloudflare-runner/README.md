# Resume CI steps on Cloudflare

Run checkout, install, and build as durable actions without handling snapshot IDs.

The Cloudflare runner checkpoints each action's workspace and restores it after
suspension or container eviction. This example disables live reuse so every
consumer restores its prerequisite's saved revision.

The snippets on this page come from this example's files, which CI runs end to
end.

## Return the workspace from each action

Create `.cloudflare/ci/actions.ts`. Each action returns its updated workspace.
That return value is what the runner saves:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source")

Create `.cloudflare/ci/workflow.ts`. It builds on manual runs:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Add the Worker adapter

Export the workflow as a Cloudflare Workflow entrypoint in `src/worker.ts`.
`reuseWorkspace: false` makes every action restore from its prerequisite's
checkpoint instead of reusing a live container:

[`src/worker.ts`](./src/worker.ts#symbol=EffectCIWorkflow "source {3}")

## Try it

Run the portable workflow locally:

```sh
cd examples/cloudflare-runner
effect-ci run
```

For native execution, follow the [host setup](../../apps/effect-ci/SELF-HOST.md).

## cf ci comparison

The [cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs `npm ci` and
`npm run build` in `app/` as two durable steps. It does not use Effect CI:

[`.cloudflare/cf-ci/src/index.ts`](./.cloudflare/cf-ci/src/index.ts#symbol=STEPS "source")

Every step starts a fresh container, so each restores the outputs of the steps
before it:

[`.cloudflare/cf-ci/src/index.ts`](./.cloudflare/cf-ci/src/index.ts#L36-L53 "source")

```sh
(cd examples/cloudflare-runner/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs cloudflare-runner
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
