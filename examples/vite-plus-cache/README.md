# Cache tasks with Vite+

Reuse build output without maintaining input and output globs.

[Source](./.cloudflare/ci/actions.ts#symbol=build "source")

Vite+ observes the task's file reads and writes. A matching run restores output
and skips the command. Effect CI only preserves the task cache between runs.

## Run it twice

```sh
pnpm exec cf-ci run --workflow examples/vite-plus-cache/.cloudflare/ci/workflow.ts
pnpm exec cf-ci run --workflow examples/vite-plus-cache/.cloudflare/ci/workflow.ts
```

The second run reports a cache hit. Change a file the build reads and it rebuilds.

The [runner policy](./src/worker.ts) preserves `node_modules/.vite/task-cache`.
Your build remains an ordinary package script; network, time, and environment
dependencies need explicit tracking when filesystem observation cannot capture them.
