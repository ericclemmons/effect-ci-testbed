# Deploy with cf using OIDC

Install the shared CI GitHub App on your repository. The hosted app operator
allows your GitHub account once; each repository then enables itself with
`cf-ci oidc`. No Cloudflare or Access secret belongs in GitHub.

Locally, sign into the shared service through Cloudflare Access, then run:

```sh
cf-ci oidc --service https://your-ci-host
```

Commit `.cloudflare/ci/oidc.json`, which contains only the public service origin
and repository name. In GitHub Actions, use the same CLI with `id-token: write`:

[Source](./.github/workflows/deploy.yml "source")

For a fresh job without committed configuration, set the public
`EFFECT_CI_REMOTE_URL`. `cf-ci oidc` verifies the signed job's repository and
GitHub App installation; it does not modify the checkout in CI.
The wrapper supplies a 15-minute Cloudflare credential only to the deploy command
and revokes it when that command exits. Account-scoped Workers Scripts Write
allows creation of a new Worker, so no bootstrap deployment is required.

The example's package script remains ordinary `cf deploy`. The same identity
also authenticates `cf-ci run --remote`; hosted runs receive a short-lived
internal identity for credential exchange.

[Shared app setup](../../apps/effect-ci/README.md#unified-cli-and-workload-identity)
and [CLI commands](../../packages/cli/README.md).
