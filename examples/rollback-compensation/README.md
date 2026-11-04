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
