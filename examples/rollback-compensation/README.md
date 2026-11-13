# Roll back after a failed action

Restore external state when deployment fails, or when a later check fails.

The runner exhausts retries, then runs rollback once. Later failures unwind
completed reversible actions in reverse completion order. Recovery does not
erase the original failure.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Add a checkout that both the deployment and its rollback use:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Define the recovery action. Here it redeploys the previous version:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=rollback "source")

Attach it to the deployment with the `rollback` option. The deployment retries
twice before the runner gives up and runs the rollback:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deploy "source {6-7}")

The deployment and reversal print messages; they do not change a real release.
A filesystem snapshot cannot reverse a database migration or deployment—supply
the appropriate recovery action.

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It runs the deployment; the rollback needs
no separate call:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/rollback-compensation
effect-ci run
```

See also [Health-gated rollout](../health-mediated-release).

## Compare with GitHub Actions

GitHub Actions has no rollback hook. The workflow lets the deploy step fail,
runs the rollback on failure, then fails the job to keep the original failure:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L21-L32 "source")

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) records whether the deploy
failed and runs the rollback only after a failure. The run still fails after a
rollback. cf ci runs start from a commit with no inputs, so the `fail-deploy`
input is a constant in the pipeline. It does not use Effect CI.

```sh
(cd examples/rollback-compensation/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs rollback-compensation
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
