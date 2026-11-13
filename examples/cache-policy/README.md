# Customize or disable caching

Keep cache storage policy out of the actions that do the work.

Vite+, Turbo and package download caches are discovered automatically by default.
Supply paths only for custom cache locations, or pass `cache: false` to disable
transport. GitHub Actions preserves the selected paths with `actions/cache`;
Cloudflare transports them through snapshots. Task tools still decide cache hits.

The snippets on this page come from this example's files, which CI runs end to
end.

## Write the actions without cache code

Create `.cloudflare/ci/actions.ts`. The build and test actions only run commands;
none of them mention a cache:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source")

Create `.cloudflare/ci/workflow.ts`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

The example's build tool reuses `app/.cache/build` when it exists and prints
whether it hit the cache:

[`app/build.ts`](./app/build.ts#L3-L16 "source")

## Set the cache policy on Cloudflare

In the runner entrypoint, `cache` names the key, the files that invalidate it,
and the paths to keep. Pass `cache: false` instead to disable transport:

[`src/worker.ts`](./src/worker.ts#symbol=EffectCIWorkflow "source {3-7}")

## Set the cache policy on GitHub

The GitHub caller passes the same policy to the reusable runner:

[`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml#L11-L19 "source {5-7}")

## Run it twice

```sh
cd examples/cache-policy
effect-ci run
effect-ci run
```

The first build creates cached output. The next reports a hit. Change
`app/src/input.txt` to invalidate it.

## Compare with GitHub Actions

A plain GitHub Actions job writes the same policy as an `actions/cache` step:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L20-L27 "source")
