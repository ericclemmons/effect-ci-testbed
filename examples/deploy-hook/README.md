# Trigger CI from a deployment hook

Send a deployment event through the same build/deploy workflow as other CI.

## Run it

From this example directory:

```sh
EFFECT_CI_EVENT=deploy_hook pnpm exec effect-ci run
```

Both `deploy_hook` and GitHub's `deployment` event select the deployment branch.
Pull requests skip it.

The example installs dependencies, builds a Worker, then runs
`cf deploy --prebuilt --dry-run`. Receiving and authenticating an HTTP webhook
belongs to the hosted service.

[Workflow](./.cloudflare/ci/workflow.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
