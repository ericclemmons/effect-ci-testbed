# Reuse the Vite+ task cache

This example answers one question:

> How can separate CI runs reuse Vite+ task results without teaching Effect CI how
> Vite+ fingerprints a build?

The two cache layers have deliberately different jobs:

1. Vite Task owns correctness. `vp run build` observes the command's file reads,
   missing-file probes, directory listings, and writes. On a matching run it restores
   `dist/`, replays the output, and skips the command. The task declares no input or
   output globs.
2. Effect CI owns persistence. After each successful action, the Cloudflare runner saves
   an immutable Container snapshot in a repository- and image-scoped rolling cache. The
   next Workflow instance forks that snapshot before checking out its requested revision.

Vite Task stores its local cache at `node_modules/.vite/task-cache`. The runner protects
that path across destructive commands on Cloudflare. On GitHub, `actions/cache` restores
the same path and the portable install action uses non-destructive `npm install`, so the
restored task cache survives until Vite+ validates it. Effect CI does not hash source
files or decide whether `build` is reusable; Vite+ makes that decision after seeing the
restored cache.

## Compare GitHub and Effect CI

- [`.github/workflows/github.yml`](./.github/workflows/github.yml) installs the app,
  restores Vite Task's directory with `actions/cache`, and invokes Vite+ directly.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml)
  gives that same directory to the reusable GitHub runner, then executes the portable
  Effect workflow.
- [`src/worker.ts`](./src/worker.ts) gives the same logical cache path to the Cloudflare
  snapshot adapter.

The cache provider changes; the Vite+ command and its correctness model do not.

The complete Vite+ configuration is intentionally this small:

```ts
export default defineConfig({
  run: {
    tasks: {
      build: "node scripts/build.ts",
    },
  },
})
```

The example's behavioral test verifies a cold miss, restoration of a deleted output,
a hit after an unrelated file changes, and a miss after the file actually read by the
build changes. That test deliberately wraps a shell build rather than a JavaScript
program: Vite+ requires a Node runtime, but the observed task can invoke Python, Rust,
Ruby, a compiler, or any other child process. Effect CI does not require every project
to adopt Vite itself. Manual tracking remains an escape hatch for environment, network,
time, or other dependencies that filesystem observation cannot see.

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

The portable workflow declares one rolling cache and the tool-owned path to protect:

```ts
CI.workflow("vite-plus-cache", workflow, {
  cache: {
    key: "vite-task",
    keyFiles: ["examples/vite-plus-cache/app/package-lock.json"],
    paths: ["examples/vite-plus-cache/app/node_modules/.vite/task-cache"],
  },
})
```

GitHub translates this policy to `actions/cache`; Cloudflare translates it to a
snapshot cache. The Worker contains no Vite-specific cache configuration.

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
