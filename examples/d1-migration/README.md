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
