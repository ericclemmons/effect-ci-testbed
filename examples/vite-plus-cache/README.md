# Cache tasks with Vite+

Reuse build output without maintaining input and output globs.

Vite+ observes the task's file reads and writes. A matching run restores output
and skips the command. Effect CI only preserves the task cache between runs.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define a Vite+ task

Add `vite-plus` to your app's dependencies:

[`app/package.json`](./app/package.json#json=dependencies "source")

Define the build as an ordinary Vite+ task in `vite.config.ts`. It is cached by
default, with no input or output lists:

[`app/vite.config.ts`](./app/vite.config.ts "source {6}")

Network, time, and environment dependencies need explicit tracking when
filesystem observation cannot capture them.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Import the SDK and the Vite+ toolchain:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L2 "source")

Check out the source and install the app's dependencies:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

Run the task with `VitePlus(workspace).run(task)`:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source {3,5}")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It runs the build:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

The [runner](./src/worker.ts) automatically preserves `node_modules/.vite/task-cache`,
including the nested app's cache. No cache key or paths are needed in the workflow.

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
[build] vite+ examples/vite-plus-cache/app#build changes:
[build]   ± examples/vite-plus-cache/app/src/message.js
```

The task runs with `vp run -v`, so its own summary lists every reason for a miss too.

## Skip the cache

Vite+ caches by file inputs, so it can skip a deploy even after remote state
changed, for example after a production rollback. `--force` runs every step:

```text
$ effect-ci run -v --force
[build] vite+ examples/vite-plus-cache/app#build: caching off
```

Vite+ tasks run with `vp run --no-cache`, and Effect CI skips its own reused
check and step results. A forced Vite+ run does not update the task cache, so the
next run without `--force` compares against the last cached run. `--force` also
applies to remote runs.

[Vite+ toolchain](../../packages/ci/src/vite-plus.ts#symbol=VitePlus "source")

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

## Compare with GitHub Actions

The GitHub Actions workflow saves and restores the task cache with
`actions/cache`:

[GitHub Actions comparison](./.github/workflows/github.yml#L11-L31 "source")
