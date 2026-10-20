# Roll back after a failed action

Restore external state when deployment fails, or when a later check fails.

```ts
export const deploy = CI.action("deploy with retries", deployBody, {
  retries: { limit: 2, delay: 0 },
  rollback,
})
```

The runner exhausts retries, then runs rollback once. Later failures unwind
completed reversible actions in reverse completion order. Recovery does not
erase the original failure.

## Run it

```sh
pnpm exec cf-ci run --workflow examples/rollback-compensation/.cloudflare/ci/workflow.ts
```

The deployment and reversal print messages; they do not change a real release.
A filesystem snapshot cannot reverse a database migration or deployment—supply
the appropriate recovery action.

[Actions](./.cloudflare/ci/actions.ts) · [Health-gated rollout](../health-mediated-release)
