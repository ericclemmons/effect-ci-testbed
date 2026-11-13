# Deploy an app to Cloudflare Workers

Test, build, and deploy one Worker. This is the usual continuous-deployment
pipeline. Other deployment recipes add ordering, triggers, or approvals to it.

```text
install → test ┐
        → build ┴→ deploy
```

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with your Worker

Use your existing Worker. This one serves a page and a health route:

[`src/index.ts`](./src/index.ts "source")

Its settings name the Worker and its entrypoint:

[`cloudflare.config.ts`](./cloudflare.config.ts "source")

## Add package scripts

CI calls the same package scripts that a conventional GitHub Actions job runs.
The [tests](./test/worker.test.ts) import the Worker's `fetch` handler directly.

[`package.json`](./package.json#json=scripts "source {5}")

## Define the actions

Create `.cloudflare/ci/actions.ts`. Check out the source and install
dependencies:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

Test and build each start from the installed workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=test "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source")

`deploy` runs only after both the tests and the build pass. It deploys the
built workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deploy "source {2-3}")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Pull requests, pushes, and manual runs all
select `deploy`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {7}")

## Run it

```sh
cd examples/workers-deploy
effect-ci run
```

## What the evidence proves

The `deploy` script runs `cf deploy --prebuilt --dry-run`, so CI needs no account
or API token. A passing run shows that the tests pass, `cf build` produces a
Worker bundle, and `cf deploy` accepts that prebuilt bundle and its settings.
It does not show that the Worker was uploaded or that it serves traffic.

To deploy for real, remove `--dry-run` and give the deploy step Cloudflare
credentials. Use [short-lived Wrangler credentials](../oidc-wrangler) or a
`CLOUDFLARE_API_TOKEN` secret. To deploy only from `main`, wrap `deploy` in the
condition from [Deploy only on matching branches or events](../conditional-deploy).

## Compare with GitHub Actions

The same pipeline as one GitHub Actions job:

[GitHub Actions comparison](./.github/workflows/github.yml#L12-L24 "source")

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs `npm ci`, test, build,
and the recipe's dry-run deploy in order. Installed dependencies and the build
output carry over as `step.runner()` outputs. It does not use Effect CI.

```sh
(cd examples/workers-deploy/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs workers-deploy
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
