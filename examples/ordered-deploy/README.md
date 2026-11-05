# Deploy apps in dependency order

Deploy the backend before the frontend that needs it.

```text
install → build applications → deploy backend → deploy frontend
```

The recipe installs its own npm workspace (`apps/*`) from its lockfile, so it
runs from this directory alone. Each deployment depends on the shared build. The aggregate deploy action calls
the two deployments in order; the build runs once.

## Condition the whole group

`CI.when` gates the aggregate deploy action, so both deployments and their shared
build run only for the listed events. The condition appears in the plan.

[Workflow](./.cloudflare/ci/workflow.ts#symbol=workflow "source")

## Run it

```sh
cd examples/ordered-deploy
effect-ci run
```

The two Workers build with `cf build` and deploy with
`cf deploy --prebuilt --dry-run`. No credentials or live deployment are needed.

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
