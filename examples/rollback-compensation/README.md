# Roll back after a failed action

Restore external state when deployment fails, or when a later check fails.

[Source](./.cloudflare/ci/actions.ts#symbol=deploy "source")

The runner exhausts retries, then runs rollback once. Later failures unwind
completed reversible actions in reverse completion order. Recovery does not
erase the original failure.

## Run it

```sh
cd examples/rollback-compensation
effect-ci run
```

The deployment and reversal print messages; they do not change a real release.
A filesystem snapshot cannot reverse a database migration or deployment—supply
the appropriate recovery action.

[Actions](./.cloudflare/ci/actions.ts) · [Health-gated rollout](../health-mediated-release)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) records whether the deploy
failed and runs the rollback only after a failure. The run still fails after a
rollback. cf ci runs start from a commit with no inputs, so the `fail-deploy` input is a constant
in the pipeline. It does not use Effect CI.

```sh
(cd examples/rollback-compensation/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs rollback-compensation
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
