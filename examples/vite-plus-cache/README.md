# Reuse the Vite+ task cache on Cloudflare

This example answers one question:

> How can separate Cloudflare Workflow instances reuse Vite+ task results without teaching Effect CI how Vite+ fingerprints a build?

The two cache layers have deliberately different jobs:

1. Vite Task owns correctness. `vp run build` tracks the command's inputs, environment,
   output files, and terminal output. On a matching run it restores `dist/`, replays the
   output, and skips the command.
2. Effect CI owns persistence. After each successful action, the Cloudflare runner saves
   an immutable Container snapshot in a repository- and image-scoped rolling cache. The
   next Workflow instance forks that snapshot before checking out its requested revision.

Vite Task stores its local cache at `node_modules/.vite/task-cache`. The runner protects
that path across destructive commands such as `npm ci`, so package installation cannot
erase the restored cache. Effect CI does not hash source files or decide whether `build`
is reusable; Vite+ makes that decision after seeing the restored cache.

The userland workflow remains ordinary:

```ts
export const build = CI.action("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec(
    "cd examples/vite-plus-cache/app && npx vp run -t vite-plus-cache-app#build",
  )
})
```

Returning the `Workspace` is significant: it tells the runner that this action produced
a new logical filesystem revision. The Cloudflare interpreter snapshots that revision,
including Vite+'s updated task cache. The action does not return a Cloudflare snapshot
or a hand-written artifact manifest.

The Worker opts into one rolling cache and identifies the tool-owned path to protect:

```ts
export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow, {
  cacheKey: "vite-plus-cache",
  cachePaths: ["node_modules/.vite/task-cache"],
  reuseWorkspace: false,
})
```

Run Wrangler locally with Docker available:

```sh
pnpm dev
```

Trigger two different Workflow instances against the same revision. The first build
populates Vite Task's cache; the second restores the rolling snapshot and reports a Vite+
cache hit:

```sh
pnpm exec wrangler workflows trigger effect-ci-vite-plus-cache \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --id vite-cache-1 \
  --local

pnpm exec wrangler workflows trigger effect-ci-vite-plus-cache \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --id vite-cache-2 \
  --local
```

Container snapshots currently have an implicit 30-day lifetime, refreshed on restore.
The cache is an optimization: a missing or expired snapshot produces a normal Vite+
cache miss. Snapshots contain the full filesystem, so commands must not persist secrets
to disk. Concurrent runs may replace the rolling pointer in either order, but every
snapshot is immutable and Vite+ still validates its own fingerprints.
