# Host the exported-action recipe independently

This package wraps the recipe's own [default workflow](../.cloudflare/ci/workflow.ts).
It imports reusable packages, not the shared app or another recipe. The fixture,
image, config and Container binding all belong to `exported-actions`.

[Deployment config](./cloudflare.config.ts "source")

[Native wrapper](./src/worker.ts#symbol=ExportedActionsWorkflow "source")

After installing repository dependencies, build the Worker bundle and local
Container image without provisioning:

```sh
cd examples/exported-actions/hosted
pnpm build
```

With approval for the account, the exact resources below and a bounded paid run:

```sh
cf deploy
cf workflows instances create effect-ci-exported-actions-checks --body '{"instance_id":"owned-exported-actions-UNIQUE_ID","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
cf workflows instances get owned-exported-actions-UNIQUE_ID --workflow-name effect-ci-exported-actions-checks
```

Use the full published commit containing this host and fixture. Checkout is
checkpointed; `check` restores it and runs `node --check app/index.js` under
`examples/exported-actions`. Live workspace reuse stays disabled. The hosted
workflow does not expose target discovery; local `cf-ci list` and `run check`
remain the CLI proof.

## Authority and evidence

Approve only Worker `effect-ci-exported-actions`, Workflow
`effect-ci-exported-actions-checks`, Container application
`effect-ci-exported-actions-workspace`, its image upload and `WorkspaceContainer`
SQLite namespace, plus their execution, snapshots and logs. No public URL,
HTTP dispatcher, secret, service binding, R2, Artifacts or release capability is
configured. Deployment credentials stay in the trusted CLI session.

Independent deployment and execution are **unverified**. Preserve
`coverage-exported-actions-20261009-2` on `effect-ci-example-exported-actions`
as shared-host history. Record the new source SHA, Worker and Workflow versions,
image digest, instance ID, checkout/restore steps and final check outcome before
calling this migration complete. A local build is not that proof.

No automatic cleanup or deletion is included. Preserve all shared-host resources
and histories; obtain separate approval for owned-resource deletion.
