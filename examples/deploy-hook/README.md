# Trigger CI from a deployment hook

Send a deployment event through the same build/deploy workflow as other CI.

The snippets on this page come from this example's files, which CI runs end to
end. The example builds a small Worker configured in
[`cloudflare.config.ts`](./cloudflare.config.ts); use your project's existing
Worker instead.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source and install dependencies:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

Build the Worker:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source")

Deploy the prebuilt output. The example passes `--dry-run`, so it does not
publish:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deploy "source '--dry-run'")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. The `requested` condition matches both
`deploy_hook` and GitHub's `deployment` event. The workflow deploys only when it
matches, so pull requests skip deployment:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {5,8}")

Receiving and authenticating an HTTP webhook belongs to the hosted service.

## Run it

From the repository root:

```sh
cd examples/deploy-hook
EFFECT_CI_EVENT=deploy_hook effect-ci run
```

## Run on GitHub

To run the same workflow from GitHub's `deployment` event, call the shared
Effect CI workflow:

[`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml "source")

## Compare with GitHub Actions

The same steps as a plain GitHub Actions workflow:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L12-L21 "source")
