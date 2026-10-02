# Reuse the Turborepo cache on Cloudflare

This example answers one question:

> How can separate Cloudflare Workflow instances reuse Turborepo task results while
> Turborepo remains responsible for deciding whether a build is valid?

The responsibilities are intentionally split:

1. Turborepo hashes the task, its inputs, and its dependencies. Its `turbo.json`
   declares `dist/**` as the build output to restore on a cache hit.
2. Effect CI persists the opaque `.turbo/cache` directory in a rolling Container
   snapshot. It does not reproduce Turborepo's hashing rules.

The userland action is an ordinary command:

```ts
export const build = CI.action("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec(
    "cd examples/turborepo-cache/app && npx turbo run build",
  )
})
```

## Verify it locally

Run the task twice from the fixture root:

```sh
npm --prefix app ci
npm --prefix app run build
npm --prefix app run build
```

The second run reports a cache hit. Delete `app/packages/message/dist` before the
second run to also see Turborepo restore the declared output.

## Verify it across Workflow instances

The Worker opts into a rolling snapshot and identifies Turborepo's default local
cache directory:

```ts
export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cacheKey: "turborepo-cache",
  cachePaths: ["examples/turborepo-cache/app/.turbo/cache"],
  reuseWorkspace: false,
})
```

Start Wrangler locally with Docker available:

```sh
pnpm dev
```

Then trigger two independent instances against the same revision:

```sh
pnpm exec wrangler workflows trigger effect-ci-turborepo-cache \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --id turbo-cache-1 \
  --local

pnpm exec wrangler workflows trigger effect-ci-turborepo-cache \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --id turbo-cache-2 \
  --local
```

The second Workflow reports `cache hit` even though it receives a fresh Container.
The same Effect CI persistence mechanism now supports two different task-cache
engines: Vite+ owns automatically tracked cache correctness, while Turborepo owns its
task hash and declared outputs.
