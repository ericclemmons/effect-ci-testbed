# Human-approved production deployment

This example answers one question:

> How do I require a human to approve a production deployment after its build dependency succeeds?

Its dependency graph is deliberately small:

```text
checkout → install → build → deploy
```

`deploy()` yields `build()`, so the deployment cannot be authored without producing
typed build artifacts first. The Effect workflow also requests `CI.Approval` inside the
deploy action. On GitHub Actions, that request is resolved by the native protected
environment gate before the deployment job starts.

## Required GitHub setup

Create an environment named `production` in **Settings → Environments**, then add one or
more **Required reviewers**. The workflow job declares `environment: production`, so
GitHub pauses it, notifies eligible reviewers, withholds environment secrets, and does
not assign a runner until somebody selects **Review deployments → Approve and deploy**.

Required reviewers on GitHub Free, Pro, and Team are available only for public
repositories. Private repositories need a plan that supports this protection rule.

## Compare the implementations

- [`.github/workflows/github.yml`](./.github/workflows/github.yml) is the conventional
  GitHub Actions version. Its deployment job `needs: build` and targets `production`.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml)
  runs the Effect workflow inside a `production` deployment job.
- [`.cloudflare/workflows/deploy.ts`](./.cloudflare/workflows/deploy.ts) declares the
  event boundary and requests only `deploy()`.
- [`.cloudflare/actions/index.ts`](./.cloudflare/actions/index.ts) makes `build()` an
  intrinsic dependency of `deploy()` and contains the portable approval request.

The deploy command is intentionally harmless:

```text
echo npx cf deploy
```

GitHub's environment gate is self-contained and needs no webhook. A future workflow
running outside GitHub Actions will need a different `CI.Approval` adapter, such as a
GitHub App check action or a Cloudflare/Slack approval channel.
