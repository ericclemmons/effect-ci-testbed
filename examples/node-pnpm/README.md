# Run CI with pnpm

Use pnpm without putting package-manager setup into every check. Lint is required,
formatting is advisory, and both run before test and build.

## Run it

```sh
cd examples/node-pnpm
effect-ci run test build
```

Request test, build, or both: their shared install and checks run once. Only
`lint`, `format`, `test`, and `build` are public CLI targets.

The [actions](./.cloudflare/ci/actions.ts) own these dependencies; the
[workflow](./.cloudflare/ci/workflow.ts) selects the goal.
Compare with [GitHub Actions YAML](./.github/workflows/github.yml).

Run the same goals through your configured hosted service from the repository root:
`effect-ci run test build --remote --workflow examples/node-pnpm/.cloudflare/ci/workflow.ts`.
No recipe-specific deployment is required; remote execution uses the pushed commit.

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs lint and optional format
in parallel, then test and build only after lint passes, with Cloudflare
Workflows `step.runner()` (internal preview). Each step starts a fresh container,
so each one enables the pinned pnpm through corepack. It does not use Effect CI.

```sh
(cd examples/node-pnpm/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs node-pnpm
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
