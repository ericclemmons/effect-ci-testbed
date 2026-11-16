# Run CI with pnpm

Use pnpm without putting package-manager setup into every check. Lint is required,
formatting is advisory, and both run before test and build.

The snippets on this page come from this example's files, which CI runs end to
end.

## Pin pnpm in package.json

Effect CI detects the package manager from the `packageManager` field or the
lockfile. This example sets the field and commits `pnpm-lock.yaml`. The checks
call your existing scripts:

[`package.json`](./package.json "source {6}")

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source, then install dependencies once.
`CI.PackageManager.JavaScript` reads the workspace and returns pnpm, so no action
sets up pnpm itself:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source 'CI.PackageManager.JavaScript(workspace)'")

Lint and format each run a package script on the installed workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=lint "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=format "source")

Test waits for both checks in parallel. `CI.optional` keeps a format failure from
blocking the test:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=test "source 'CI.parallel([lint(), CI.optional(format())])'")

Build runs after test:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It builds on pull requests, pushes, and
manual runs. The named exports make `lint`, `format`, `test`, and `build` public
CLI targets:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {16}")

## Run it

```sh
cd examples/node-pnpm
effect-ci run test build
```

Request test, build, or both: their shared install and checks run once. Only
`lint`, `format`, `test`, and `build` are public CLI targets.

Run the same goals through your configured hosted service from the repository root:
`effect-ci run test build --remote --workflow examples/node-pnpm/.cloudflare/ci/workflow.ts`.
No recipe-specific deployment is required; remote execution uses the pushed commit.

## Compare with GitHub Actions

GitHub Actions sets up pnpm in every job and marks format as optional with
`continue-on-error`:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L44 "source")
