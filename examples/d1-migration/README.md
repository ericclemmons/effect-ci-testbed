# Migrate D1 before deploying a Worker

This example answers one question:

> How do I guarantee that a required D1 migration completes before its Worker deploys?

The portable dependency graph is encoded in the actions themselves:

```text
checkout → build → migrate database → deploy worker
```

`deploy()` yields `migrate()`, and `migrate()` yields `build()`. Running the workflow—or
targeting `deploy` directly—therefore cannot skip either prerequisite. Each successful
action returns the next `CI.Workspace` revision, so a durable runner can checkpoint the
exact built and migrated filesystem consumed by deployment.

The fixture prints the real Wrangler command but records a local schema marker instead
of mutating a remote database. `deploy.mjs` refuses to continue unless both the build
output and expected migration marker exist.

Compare the conventional [GitHub Actions workflow](./.github/workflows/github.yml) with
the portable [actions](./.cloudflare/ci/actions.ts) and
[workflow](./.cloudflare/ci/workflow.ts).

## Rollback is compensation, not rewind

A workspace checkpoint cannot roll back D1 because the database is external state.
Effect CI models that recovery explicitly with:

```ts
yield* CI.compensate(actions.deploy(), actions.rollback())
```

The safe default should be:

1. author expand/contract migrations that remain compatible with both Worker versions;
2. apply the forward migration;
3. attempt the new Worker deployment;
4. on failure, redeploy the last compatible Worker version;
5. run a down-migration only when the project explicitly defines one as safe and
   idempotent.

The original deployment failure and every compensation remain separate durable
steps with their own outputs. If compensation also fails, the run must preserve both
errors rather than replacing the original failure. A retry should reuse the successful
migration checkpoint and retry only the affected deployment/compensation subgraph.

The deploy action retries twice before compensation becomes eligible. The portable plan
contains the compensation edge, unlike an ordinary hidden `Effect.catch` branch.
