# Host the pnpm recipe independently

This package hosts only the [pnpm fixture](../README.md). Hosting dependencies
stay out of the fixture's package.json and frozen lockfile. The wrapper retains
the shared host's pinned pnpm bootstrap and `standard-1` instance selection;
the recipe now owns its image, config and Container binding.

[Deployment config](./cloudflare.config.ts "source")

[Native wrapper](./src/worker.ts#symbol=NodePnpmWorkflow "source")

After installing repository dependencies, build the Worker bundle and local
Container image without provisioning:

```sh
cd examples/node-pnpm/hosted
pnpm build
```

With approval for the account, the exact resources below and a bounded paid run:

```sh
cf deploy
cf workflows instances create effect-ci-node-pnpm-checks --body '{"instance_id":"owned-node-pnpm-UNIQUE_ID","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
cf workflows instances get owned-node-pnpm-UNIQUE_ID --workflow-name effect-ci-node-pnpm-checks
```

Use the full published commit containing this host and fixture. The default
workflow runs checkout, frozen installation, required lint, advisory formatting,
test and build. This host does not add a remote CLI target-selection API.
The root is `examples/node-pnpm` within the requested repository.

## Authority and evidence

Approve only Worker `effect-ci-node-pnpm`, Workflow `effect-ci-node-pnpm-checks`,
Container application `effect-ci-node-pnpm-workspace`, its image upload and
`WorkspaceContainer` SQLite namespace, plus their execution, snapshots and logs.
The Container can fetch the pinned pnpm release and package dependencies.
No public URL, HTTP dispatcher, secret, service binding, R2, Artifacts or release
capability is configured. Keep deployment credentials in the trusted CLI session,
not in workflow parameters or the workload.

Independent deployment and execution are **unverified**. Keep
`coverage-node-pnpm-20261008-6` on `effect-ci-example-node-pnpm` as shared-host
history. A new receipt must identify source SHA, Worker and Workflow versions,
image digest, instance ID and final native/consumer outcomes, including the
optional formatting warning. Local build success does not supply that receipt.

No cleanup runs automatically. Deleting owned resources needs separate approval;
do not delete or rename the shared host or its histories.
