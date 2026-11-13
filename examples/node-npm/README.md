# Run CI with npm

Write checkout, install, lint, test, and build once, then run the same workflow
locally or in CI. The lockfile selects npm automatically.

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with your npm scripts

Use your project's existing `package.json` and `package-lock.json`. The workflow
runs these scripts by name:

[`package.json`](./package.json#json=scripts "source")

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Install dependencies. `CI.PackageManager.JavaScript(workspace)` detects npm from
the lockfile and runs `npm ci`:

[Install action](./.cloudflare/ci/actions.ts#symbol=install "source 'npm.install()'")

Each script action calls `install()` first, so Effect CI runs the shared
installation once. `lint` runs the `lint` script:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=lint "source 'npm.run(\"lint\")'")

`test` and `build` are the same, with `npm.run("test")` and `npm.run("build")`.

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It runs lint, test, and build on pull
requests, pushes, and manual runs:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/node-npm
effect-ci run
```

## Compare with GitHub Actions

The same pipeline as plain GitHub Actions YAML:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L12-L23 "source")

## Hosted runner

Use the same workflow on your configured hosted runner with
`effect-ci run --remote --workflow examples/node-npm/.cloudflare/ci/workflow.ts`
from the repository root. No recipe-specific deployment is required. Remote
execution uses the clean, pushed commit, not local edits.

## Task-cache limitation

Use [pnpm](../node-pnpm/) when you need Vite+ task-cache reuse with the hosted
runner. npm workflows can run, but the default task cache does not survive their
frozen installs.

`CI.PackageManager.JavaScript(workspace).install()` defaults to `npm ci` for npm.
[npm ci removes existing node_modules contents](https://docs.npmjs.com/cli/v11/commands/npm-ci/),
including the [Vite+ task cache](https://viteplus.dev/guide/cache) at
`node_modules/.vite/task-cache`. The host restores that path before installation,
so a restored snapshot alone does not establish a task-cache hit.

The standalone host installs dependencies before invoking the project CLI; an
inferred workflow installs again. Either clean install clears the task
cache. The separate npm download cache at `.effect-ci/cache/npm` does not hold
task results, and the host's default transport policy preserves only the Vite+
task-cache path.

Keep the frozen install default. `{ frozenLockfile: false }` selects `npm install`
and can update the lockfile; it is not a task-cache fix. The runner does not save
and restore Vite+ state around npm installs. A pnpm recommendation also does not
guarantee a hit: matching task inputs and readable cache-hit output from a second
run are still required.
