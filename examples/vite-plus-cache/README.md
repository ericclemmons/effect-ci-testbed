# Cache tasks with Vite+

Reuse build output without maintaining input and output globs.

[Source](./.cloudflare/ci/actions.ts#symbol=build "source")

Vite+ observes the task's file reads and writes. A matching run restores output
and skips the command. Effect CI only preserves the task cache between runs.

## Run it twice

```sh
cd examples/vite-plus-cache
effect-ci run
effect-ci run
```

The second run reports a cache hit. Change a file the build reads and it rebuilds.

`CI.VitePlus.run` first asks Vite+ for its run plan (`vp run --dry-run --json -v`)
and notes under the step whether it was cached, and why not:

```text
✓ build depends on install
  vite+ examples/vite-plus-cache/app#build: not cached: 'examples/vite-plus-cache/app/src/message.js' changed
```

The run itself uses `-v`, so its log lists every reason for a miss.

[Vite+ run helper](../../packages/ci/src/index.ts#symbol=vitePlusRun "source")

The [runner](./src/worker.ts) automatically preserves `node_modules/.vite/task-cache`,
including the nested app's cache. No cache key or paths are needed in the workflow.
Your build remains an ordinary package script; network, time, and environment
dependencies need explicit tracking when filesystem observation cannot capture them.

[Automatic data tracking](https://viteplus.dev/guide/automatic-data-tracking)
owns input/output discovery. Cache-enabled tasks track file reads and writes;
arbitrary commands may still need explicit environment-variable configuration.
