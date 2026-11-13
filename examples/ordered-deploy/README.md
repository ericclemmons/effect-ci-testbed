# Deploy apps in dependency order

Deploy the backend before the frontend that needs it.

```text
install → build applications → deploy backend → deploy frontend
```

The recipe installs its own npm workspace (`apps/*`) from its lockfile, so it
runs from this directory alone. Each Worker in `apps/` has an ordinary `cf`
configuration, such as [`apps/backend/cloudflare.config.ts`](./apps/backend/cloudflare.config.ts).

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source and install the workspace once:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

Build both applications in one action. Each deployment depends on this shared
build, so it runs once:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source")

Deploy the backend from the build output. The frontend deployment calls
`deployBackend()`, so it cannot start until the backend is deployed:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deployBackend "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deployFrontend "source 'yield* deployBackend()'")

Export one aggregate deploy action that calls the two deployments in order:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deploy "source")

## Condition the whole group

Create `.cloudflare/ci/workflow.ts`. `CI.when` gates the aggregate deploy action,
so both deployments and their shared build run only for the listed events. The
condition appears in the plan.

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {6-9}")

## Run it

```sh
cd examples/ordered-deploy
effect-ci run
```

The two Workers build with `cf build` and deploy with
`cf deploy --prebuilt --dry-run`. No credentials or live deployment are needed.

## Compare with GitHub Actions

GitHub Actions lists the same commands as steps in one job:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L12-L25 "source")

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) installs once, builds the
backend then the frontend, and dry-runs their deploys in the same order. Each
step restores the outputs of the steps before it. It does not use Effect CI.

```sh
(cd examples/ordered-deploy/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs ordered-deploy
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
