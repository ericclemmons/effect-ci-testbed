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

With `-v`, Effect CI logs whether each Vite+ step would hit the cache, and every
change behind a miss, before it runs. `-vv` also lists the cached run's inputs and outputs.

```text
$ effect-ci run -v
[build] vite+ examples/vite-plus-cache/app#build: not cached
[build]   'examples/vite-plus-cache/app/src/message.js' changed
```

The task runs with `vp run -v`, so its own summary lists every reason for a miss too.

[Vite+ toolchain](../../packages/ci/src/vite-plus.ts#symbol=VitePlus "source")

The [runner](./src/worker.ts) automatically preserves `node_modules/.vite/task-cache`,
including the nested app's cache. No cache key or paths are needed in the workflow.
The build is an ordinary Vite+ task, cached by default, with no input or output
lists; network, time, and environment dependencies need explicit tracking when
filesystem observation cannot capture them.

[Vite+ task](./app/vite.config.ts "source")

## Speed up an existing workflow

Effect CI does not cache arbitrary `workspace.exec` commands. To cache them, ask
your coding agent:

```text
Move the build, lint and test commands this workflow runs with workspace.exec or
package.json scripts into Vite+ tasks in vite.config.ts. Run them with
VitePlus(workspace).run(task) from @effect-ci-testbed/ci/vite-plus. Leave deploy
and publish steps as they are. Then run `effect-ci run -v` twice and check that the
second run reports each task as cached.
```

[Automatic data tracking](https://viteplus.dev/guide/automatic-data-tracking)
owns input/output discovery. Cache-enabled tasks track file reads and writes;
arbitrary commands may still need explicit environment-variable configuration.
