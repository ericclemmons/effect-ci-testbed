# Run CI with npm

Write checkout, install, lint, test, and build once, then run the same workflow
locally or in CI. The lockfile selects npm automatically.

[Source](./.cloudflare/ci/actions.ts#symbol=install "source")

## Run it

```sh
cd examples/node-npm
effect-ci run
```

[Actions](./.cloudflare/ci/actions.ts) declare their own prerequisites: build
depends on test, which depends on lint. Shared installation runs once.

Compare the [Effect workflow](./.cloudflare/ci/workflow.ts) with
[GitHub Actions YAML](./.github/workflows/github.yml).

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
