# Run existing Turbo CI tasks

Build a shared TypeScript library, a storefront, and an inventory dashboard with
the project's existing Turbo graph. One Effect CI action runs `npm run ci`.
Turbo schedules independent tasks and restores its cache inside one workspace.

[Workflow](./.cloudflare/ci/workflow.ts "source")

## Same apps, two execution models

This project is identical to [the distributed recipe's app](../turbo-distributed).
Both use TypeScript to compile core, esbuild to bundle two browser apps, and
TypeScript to check each app. There are no artificial delays or CPU workloads.

[Shared catalog](./app/packages/core/src/index.ts "source")

[Storefront](./app/packages/web/src/main.ts "source")

[Inventory dashboard](./app/packages/admin/src/main.ts "source")

[App commands](./app/packages/web/package.json#json=scripts "source")

Here, normal Turbo runs all five tasks on one machine, with its own parallelism
and native local cache. In the distributed recipe, the SDK maps the same native
graph to separate snapshot-backed CI actions. It does not require different app
scripts or a second package/task graph.

## Existing project configuration

The recipe's `ci` script queries Turbo's resolved `ci` tags, excludes `!ci`
entrypoints, then calls normal `turbo run` with the selected targets.
It is not a built-in `turbo run ci` command or automatic SDK detection.

[Native entrypoint](./app/scripts/ci.mjs "source")

[Root tasks](./app/turbo.json#json=tasks "source")

Both app builds and checks require core's build through `^build`.
Core's JavaScript and type declarations are real inputs to the apps.

- Core's `build` has `!ci` but remains a required dependency.
- Core's unused `check` has `!ci` and does not run.
- Admin's `build` appends its own tag with `$TURBO_EXTENDS$`.
- Legacy's `build` has both `ci` and `!ci`; its `check` clears inherited tags.
  Neither legacy command runs.

[Core overrides](./app/packages/core/turbo.json "source")

[Admin inheritance](./app/packages/admin/turbo.json "source")

[Legacy exclusions](./app/packages/legacy/turbo.json "source")

## Run it

From the repository root:

```sh
npm --prefix examples/turbo-ci/app ci
npm --prefix examples/turbo-ci/app run ci -- --plan
npm --prefix examples/turbo-ci/app run ci
npm --prefix examples/turbo-ci/app run ci
```

The first execution compiles core, bundles both apps, and checks their types.
The next run reports five cache hits. Outputs are core's `dist/index.js` and
`dist/index.d.ts`, plus each app's `dist/app.js` and `dist/index.html`.

To prove restoration rather than leaving previous files in place:

```sh
rm -rf examples/turbo-ci/app/packages/{core,web,admin}/dist
npm --prefix examples/turbo-ci/app run ci
```

Change a product in `packages/core/src/index.ts` and rerun: core and both apps'
dependent builds/checks invalidate through the native graph. The command writes
a native run summary under `app/.turbo/runs` and stores its cache under
`app/.effect-ci/turbo/cache`.

To run the same command through Effect CI:

```sh
effect-ci plan --workflow examples/turbo-ci/.cloudflare/ci/workflow.ts
effect-ci run --workflow examples/turbo-ci/.cloudflare/ci/workflow.ts
```

This recipe does not distribute tasks across Containers or sign execution.
The distributed recipe demonstrates graph-to-action mapping and describes its
remaining transport, runtime, and trust limits. Small projects may run faster
here because they avoid per-task snapshot and orchestration costs.
