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
pnpm exec effect-ci run --workflow examples/d1-migration/.cloudflare/ci/workflow.ts
```

This applies the migration to local D1 and dry-runs deployment. No production
database changes. The current `cf d1 --local` command can hang on GitHub-hosted
Ubuntu, so use the local recipe there with care.

For production, supply the database ID and deployment credentials through the
runner. Prefer compatible expand/contract migrations; a filesystem rollback
cannot reverse D1. Only attach a database reversal when the project defines it
as safe.

[Workflow](./.cloudflare/ci/workflow.ts) · [Rollback](../rollback-compensation)
