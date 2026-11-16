# Approve a deployment in GitHub

Build first, then pause for a human before deploying.

The deployment action depends on build and requests `CI.Approval`. The GitHub job
selects the `production` environment, whose required reviewers approve it.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out, install, and build. Each action calls the one before it:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source")

Deploy after the build passes. The action asks `CI.Approval` for a decision
before it runs the deploy command. The example's deploy command only prints a
message:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deploy "source {3-8}")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It deploys only on manual runs:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {8-10}")

## Run it on GitHub with an environment

Add a GitHub workflow that runs the Effect workflow in the `production`
environment:

[`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml#L9-L16 "source {6-7}")

## Set it up

1. Create `production` in **Settings → Environments** and configure required
   reviewers.
2. Run the deployment workflow.
3. Choose **Review deployments → Approve and deploy**. Rejecting stops
   deployment.

GitHub must support required environment reviewers for your repository and plan.

## Compare with GitHub Actions

Plain GitHub Actions splits build and deploy into two jobs and passes the build
through an artifact. The `deploy` job selects the `production` environment:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L9-L38 "source 'environment: production'")

For approval in Slack instead, see [Slack approval](../cloudflare-hitl-release).
