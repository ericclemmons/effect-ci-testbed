# Deploy with cf using OIDC

Deploy a Worker with `cf deploy` from GitHub Actions, using a short-lived
Cloudflare credential from Effect CI. No Cloudflare or Access secret belongs in
GitHub.

The snippets on this page come from this example's files.

## Enable the repository

Install the shared CI GitHub App on your repository. The hosted app operator
allows your GitHub account once; each repository then enables itself with
`effect-ci oidc`.

Locally, sign into the shared service through Cloudflare Access, then run:

```sh
effect-ci oidc --service https://your-ci-host
```

Commit `.cloudflare/ci/oidc.json`, which contains only the public service origin
and repository name.

## Keep your deploy script

Your project keeps its ordinary `cf` configuration and `cf deploy` script. Nothing
in them knows about OIDC:

[`cloudflare.config.ts`](./cloudflare.config.ts "source")

[`package.json`](./package.json#json=scripts "source 'cf deploy'")

## Wrap the deploy in GitHub Actions

Add a workflow with `id-token: write`. Run `effect-ci oidc` once to verify the
job, then wrap the deploy command with `effect-ci oidc --`:

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml "source {6,18-21}")

For a fresh job without committed configuration, set the public
`EFFECT_CI_REMOTE_URL`. `effect-ci oidc` verifies the signed job's repository and
GitHub App installation; it does not modify the checkout in CI.

The wrapper supplies a 15-minute Cloudflare credential only to the deploy command
and revokes it when that command exits. Account-scoped Workers Scripts Write
allows creation of a new Worker, so no bootstrap deployment is required.

The same identity also authenticates `effect-ci run --remote`; hosted runs
receive a short-lived internal identity for credential exchange.

## Check the deployment

[`verify.mjs`](./verify.mjs) fetches the deployed Worker on
`workers.dev` and checks its response.

## Related

[Shared app setup](../../apps/effect-ci/README.md#unified-cli-and-workload-identity)
and [CLI commands](../../packages/cli/README.md). The
[Wrangler version](../oidc-wrangler) uses the same flow with `wrangler deploy`.
