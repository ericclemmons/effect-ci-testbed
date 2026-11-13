# Cache tasks with Turborepo

Keep Turborepo's task cache between CI runs without recreating its hashing rules.

Turborepo decides whether the task inputs match and restores `dist/**` on a hit.
Effect CI's runner discovers and persists `.turbo/cache` between runs, including
the nested app's cache. No runner cache key or paths are needed.

The snippets on this page come from this example's files, which CI runs end to
end.

## Configure Turborepo

Use your project's existing `turbo.json`. Declare each task's outputs so a cache
hit can restore them, and keep the cache in `.turbo/cache`:

[`app/turbo.json`](./app/turbo.json "source {4,10}")

## Define the actions

Create `.cloudflare/ci/actions.ts`. Check out the source and install the app's
dependencies:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

Run the build through Turborepo. The action needs no cache settings:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source 'npx turbo run build'")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It runs the build:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

The Cloudflare [runner](./src/worker.ts) uses the standard workflow entrypoint.
It preserves `.turbo/cache` without extra configuration.

## Try it

From this example directory:

```sh
npm --prefix app ci
npm --prefix app run build
npm --prefix app run build
```

The second build reports a hit. Change a build input and run again to see a miss.

## Use Turborepo Remote Cache

You can also use Turborepo's native Remote Cache. Its endpoint, team and signing
credentials belong in runner configuration, not action definitions.

## Compare with GitHub Actions

The GitHub Actions workflow saves and restores the same directory with
`actions/cache`:

[GitHub Actions comparison](./.github/workflows/github.yml#L11-L29 "source")
