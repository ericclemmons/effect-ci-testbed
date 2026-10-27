# Migrate D1 before deploying a Worker

Make database migration a prerequisite of deployment, including when deploy is
selected directly.

```text
build → migrate database → deploy worker
```

[Actions](./.cloudflare/ci/actions.ts "source")

[Configuration](./cloudflare.config.ts "source")

## Compatibility contract

The first migration creates `users`. The second expands it with a nullable
`display_name`; it does not rename columns, delete rows, or backfill data.
The old Worker only counts users and remains compatible with the expanded table.
The new Worker also counts non-null display names, so its query requires the
second migration. Existing rows remain valid and have a null display name.

[Initial schema](./migrations/0001_create_users.sql "source")

[Expansion](./migrations/0002_add_display_name.sql "source")

[Worker](./src/index.ts "source")

On deployment failure, keep the expanded schema and the old Worker. Retry the
same immutable migration files; the migration ledger skips applied filenames.
There is no database rollback callback and no automatic deployment retry. A real
upload with an uncertain result needs remote-state reconciliation before retry.
Do not clear the ledger or rewind D1 when reverting a filesystem snapshot.

Contract is a separate, future release: only remove an old column after all old
readers/writers and their rollback window have retired. This fixture does not
perform a destructive contract migration or claim zero downtime.

## Run locally

```sh
pnpm exec cf-ci run --workflow examples/d1-migration/.cloudflare/ci/workflow.ts
```

This applies both migrations to local D1 and **dry-runs** Worker deployment. It
does not publish a Worker or change a hosted database. The pinned `cf` CLI uses a
database UUID; without `--local` it targets hosted D1. Do not remove `--local` as
a shortcut. Its local D1 command may hang on GitHub-hosted Ubuntu.

To stop after migration, run with `EFFECT_CI_D1_FAIL_DEPLOY=1`. That intentionally
fails before the dry-run upload. Rerun without the flag to keep the schema/data
and skip migrations already in `d1_migrations`. This models a known pre-upload
failure, not a lost upload acknowledgement or a Cloudflare service outage.

[Failure injection](./deploy.mjs "source")

## Hosted scope

Hosted D1 and deployment authority is not implied by local execution or the
closed HMD upload issue. The existing fixed-target broker owns only the HMD
Worker; the native main-deploy proxy only authorizes the two product apps.
Do not send deployment tokens into recipe containers, commit secrets, broaden
those targets, or add D1 to shared OIDC scopes without approval.

[Proposed disposable targets and remaining evidence](./HOSTED.md)

[Workflow](./.cloudflare/ci/workflow.ts "source")
