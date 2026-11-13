# Cache dependency downloads

Avoid downloading packages again without skipping installation.

The capability uses `.effect-ci/cache/npm`. The runner persists that directory;
npm still runs the locked install against the current checkout.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source. The project lives in `app/`, so the action returns that
directory as the workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source 'workspace.directory(\"app\")'")

Install with the package manager capability. It points npm at
`.effect-ci/cache/npm` inside the workspace, so you do not configure the cache
here. The optional `offline` setting fails the install if a package is not
already cached:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source 'npm.install(options)'")

Run the project's script on the installed workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=verify "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It passes an optional `offline` parameter
from the event payload to the install:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {13-15}")

## Persist the cache directory

The hosted runner keeps the directory between runs. Configure it in
`src/worker.ts`. `keyFiles` ties the cache to the lockfile, and `paths` names the
directory the install writes:

[`src/worker.ts`](./src/worker.ts "source {15-19}")

## Run it

```sh
cd examples/package-manager-cache
effect-ci run
effect-ci run
```

The second run can reuse downloads. This caches package bytes, not the result
of a test or build. See [Task caching](../vite-plus-cache) to skip unchanged
work.

## Compare with GitHub Actions

`actions/setup-node` caches npm downloads keyed on the lockfile:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L25 "source {9-12}")
