# Migrate D1 before deploying a Worker

Make database migration a prerequisite of deployment, including when deploy is
selected directly.

```text
build → migrate database → deploy worker
```

The snippets on this page come from this example's files, which CI runs end to
end.

## Declare the database

In `cloudflare.config.ts`, bind a D1 database to the Worker:

[`cloudflare.config.ts`](./cloudflare.config.ts "source {9}")

Add the migration that creates the table:

[`migrations/0001_create_users.sql`](./migrations/0001_create_users.sql "source")

## Encode the order in actions

Create `.cloudflare/ci/actions.ts`. Check out and build the Worker:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L13 "source")

The migrate action requires the build and applies migrations to local D1:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=migrate "source")

The deploy action requires the migration, so selecting deploy directly still
migrates first. It retries a failed deploy:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deploy "source {2}")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It deploys on pull requests, pushes, and
manual runs:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

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

This example attaches one to the migrate action with `rollback`. It drops the
table and removes the migration record:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=rollbackMigration "source")

See [Rollback](../rollback-compensation) for how compensation runs.

## cf ci comparison

The [cf ci workflow](./.cloudflare/cf-ci/src/index.ts) builds the Worker, applies
the migration to local D1, and dry-runs the deploy. If the migration or deploy
fails, it rolls the migration back and still fails. The local D1 state carries
over as an output. It does not use Effect CI:

[`.cloudflare/cf-ci/src/index.ts`](./.cloudflare/cf-ci/src/index.ts#L44-L58 "source")

```sh
(cd examples/d1-migration/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs d1-migration
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
