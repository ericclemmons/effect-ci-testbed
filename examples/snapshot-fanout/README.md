# Run checks in parallel from one workspace

Install once, then give parallel checks independent copies of the prepared files.

The snippets on this page come from this example's files, which CI runs end to
end.

## Prepare the workspace once

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source and select the `app` directory:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Prepare the workspace. Here preparation writes one file in place of a real
install:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=prepare "source")

## Branch from the prepared workspace

Each check yields the same `prepare()` dependency, then writes `branch.txt`
without changing the other's files or the prepared workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=isolatedCheck "source {4}")

Create one check per branch:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L30-L31 "source")

## Run the branches in parallel

Create `.cloudflare/ci/workflow.ts`. It runs both checks with `CI.parallel`.
`prepare()` runs once:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {5,8-11}")

The workflow also exports a [local adapter](./.cloudflare/ci/local.ts) for
`effect-ci run`. It copies the example's `app/` directory per action. It
isolates files, not untrusted commands from the host. Cloudflare uses workspace
snapshots and separate containers.

## Run it

```sh
cd examples/snapshot-fanout
effect-ci run
```

## Compare with GitHub Actions

GitHub Actions uploads the prepared file as an artifact, then downloads it into
each matrix job:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L51 "source")
