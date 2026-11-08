# Migrate D1 before deploying a Worker

Make database migration a prerequisite of deployment, including when deploy is
selected directly.

```text
build → migrate database → deploy worker
```

The [actions](./.cloudflare/ci/actions.ts) encode those dependencies. The
[configuration](./cloudflare.config.ts) declares D1, and
[the migration](./migrations/0001_create_users.sql) creates the table.

## Run it

```sh
cd examples/d1-migration
effect-ci run
```

This applies the migration to local D1 and dry-runs deployment. No production
database changes. Use `cf` 1.0.0-beta.24 or later: earlier versions can leave
the local runtime's file watcher open, so `cf d1 --local` never exits on Linux.

For production, supply the database ID and deployment credentials through the
runner.

## Rollback is not filesystem rewind

Prefer compatible expand/contract migrations; a filesystem rollback
cannot reverse D1. Only attach a database reversal when the project defines it
as safe.

[Workflow](./.cloudflare/ci/workflow.ts) · [Rollback](../rollback-compensation)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) builds the Worker, applies
the migration to local D1, and dry-runs the deploy. If the migration or deploy
fails, it rolls the migration back and still fails. The local D1 state carries
over as an output. It does not use Effect CI.

```sh
(cd examples/d1-migration/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs d1-migration
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
