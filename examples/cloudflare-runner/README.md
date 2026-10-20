# Resume CI steps on Cloudflare

Run checkout, install, and build as durable actions without handling snapshot IDs.

An action returns its updated workspace:

```ts
export const build = CI.action("build", () => function* () {
  const workspace = yield* install()
  return yield* workspace.exec("npm run build")
})
```

The Cloudflare runner checkpoints that workspace and restores it after suspension
or container eviction. This example disables live reuse so every consumer restores
its prerequisite's saved revision.

## Try it

Run the portable workflow locally:

```sh
pnpm exec cf-ci run --workflow examples/cloudflare-runner/.cloudflare/ci/workflow.ts
```

For native execution, follow the [host setup](../../apps/effect-ci/SELF-HOST.md).
[Worker adapter](./src/worker.ts) · [Actions](./.cloudflare/ci/actions.ts)
