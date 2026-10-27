# Disposable D1 campaign proposal

Issue: https://github.com/ericclemmons/effect-ci-testbed/issues/152

Status: preparation only. No hosted resources, grants, credentials or deployment
have been changed. No target-environment or GitHub deployment comparison result
is claimed.

## Exact approval needed

Approve one disposable D1 database named `effect-ci-d1-migration-152` and one
Worker named `effect-ci-d1-migration-152`, in demo account
`0db135ec469e2f216fcea26426f29755` (the account in the retained OIDC grants).
Record the exact account/database UUIDs before enabling hosted writes. If either
name already exists, stop and verify ownership and contents; do not adopt it.
Use synthetic data only: one `fixture-152@example.invalid` user with a fixed ID.
Both providers must serialize their campaigns against this one pair of targets.

Requested operations: create the dedicated database/Worker once, apply the two
checked-in migrations, insert the synthetic row once with a unique key, query
the schema/ledger/row, deploy the old and new fixture Worker, and read their
deployment identities and HTTP results. No production access, schema reversal,
deletion, Time Travel restore, automatic cleanup, additional target, or paid-plan
change is included. Resource usage/spend needs Eric's approval too.

Credentials stay in the existing trusted host. Reuse Access, signed run identity
and callback verification. Authorize only these target operations through an
explicit host-owned capability; project containers receive neither the real
credential nor arbitrary SQL/target authority. Do not reuse the HMD target or
silently add database permission to the shared OIDC credential.

## Process and implementation sources

- Cloudflare's [migration guide](https://developers.cloudflare.com/d1/reference/migrations/),
  updated June 8, 2026, describes the migration ledger. The installed
  `cf@1.0.0-beta.12` implementation accepts UUIDs, unlike Wrangler binding names,
  and uses hosted D1 unless `--local` is supplied.
- [Host deployment/authentication](../../apps/effect-ci/README.md) and
  [fixed-target broker](../../test/apps/release-manager/README.md) define the
  existing credential boundary. Neither currently provides a dedicated D1
  capability for this recipe. No approved D1-specific setup SOP was found.
- [Shared identity deployment](../oidc-cf/README.md) and
  [retained hosted recipe campaign](../parallel-recipes-verification.md) are prior
  art for deployment and evidence, not authorization to extend credentials.
- [Issue #142](https://github.com/ericclemmons/effect-ci-testbed/issues/142)
  closed October 16, 2026. Its fixed HMD upload acceptance does not approve this
  database or Worker.

The process and prior art agree: obtain target authority first; retain host-only
credentials. The missing D1 capability remains follow-up work after approval,
not an implemented API in this PR.

## Required campaign

| Phase | Evidence to retain |
| --- | --- |
| Baseline | Exact commit, account/DB/Worker identity, migration 0001 ledger, synthetic row, old Worker version and `{users: 1}` response. |
| Expand | Apply 0002 before any new Worker upload; capture ledger/schema and unchanged synthetic row. Old Worker must still serve `{users: 1}`. |
| Known deployment failure | Inject failure after expansion but before upload; capture failed run and unchanged old deployment identity/response. Keep DB and ledger. |
| Explicit retry | Reapply the same migration files; prove both names occur once, no pending migrations, unchanged row, then publish new Worker and capture its version and `{users: 1, namedUsers: 0}` response. |
| Replay | Reapply migrations again; prove unchanged rows and exactly one ledger entry per filename. A fresh source checkout must not reset the ledger. |
| GitHub comparison | Run the equivalent baseline/expand/failure/retry with ordinary GitHub Actions using the same host-owned capability; preserve run URLs, exact SHA, ordering and remote assertions. Do not substitute the existing plan/build-only job. |

The approval must identify who can grant the narrow hosted capability. A local
CLI run, mocked executor, dry run, or SQLite check cannot satisfy these hosted
rows. Record actual run/deployment IDs only after they exist. A lost-ack campaign
would need reconciliation and is not covered by the known pre-upload failure.

## Call boundaries

Baseline: landed `main` at `20f29103911800606929de4f9afa095667606e48`.
The local changes in this PR are implemented but unlanded; hosted operations
below are future pseudocode, not existing broker methods.

```diff
 workflow() → deploy()
   migrate()
     build()
       checkout() → Source.checkout()
       Workspace.exec(command: string) → cf build
     Workspace.exec(command: string) → cf d1 migrations apply --local
-    on failure: rollbackMigration() → DROP TABLE users; DELETE migration ledger
-  Workspace.exec(command: string) → cf deploy --dry-run, automatic retries
+  Workspace.exec(command: string) → node deploy.mjs
+    known injected failure → stop before dry-run; retain DB and migration ledger
+    otherwise → cf deploy --dry-run
```

After target approval, the proposed full hosted path replaces, rather than
removes guards from, those local commands:

```diff
 workflow() → deploy()
   migrate()
     build() → checkout() → Source.checkout()
       Workspace.exec(command: string) → cf build
-    Workspace.exec(command: string) → cf d1 migrations apply --local
+    host.applyApprovedMigrations(scope, sourceSha) → fixed DB, checked-in SQL only
-  Workspace.exec(command: string) → node deploy.mjs → cf deploy --dry-run
+  known injected failure → retain DB and old Worker; fail the run
+  host.deployApprovedWorker(scope, sourceSha) → fixed Worker, real upload
+    success → read back deployment identity and served response
+    uncertain upload → stop; host reconciles current version before retry
```

The host owns credentials, target validation, SQL allowlisting and reconciliation;
its result returns through the existing signed run/callback path. Explicit retry
re-enters migration bookkeeping; it does not clear the ledger. Neither failure
path deletes a database or releases a cleanup callback. GitHub Actions would use
the same host-owned boundary, not a D1 token in the job or project container.

[Local validation and its limits](./verification.md)
