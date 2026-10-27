# Host the npm recipe independently

This package hosts only the [npm fixture](../README.md). Its Worker, Workflow,
SQLite Container binding and image do not import the shared example app or
another recipe. Only reusable packages are shared. The fixture's package.json
and npm lockfile are unchanged.

[Deployment config](./cloudflare.config.ts "source")

[Native wrapper](./src/worker.ts#symbol=NodeNpmWorkflow "source")

After installing repository dependencies, build the Worker bundle and local
Container image without provisioning:

```sh
cd examples/node-npm/hosted
pnpm build
```

Deployment requires approval for the account, the exact resources below and a
bounded paid run. It is not part of the build command. With that approval:

```sh
cf deploy
cf workflows instances create effect-ci-node-npm-checks --body '{"instance_id":"owned-node-npm-UNIQUE_ID","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
cf workflows instances get owned-node-npm-UNIQUE_ID --workflow-name effect-ci-node-npm-checks
```

Use the full published commit containing this host and fixture. This executes
the default workflow: checkout, frozen npm install, lint, test and build.
The root is `examples/node-npm` within that repository; this is not a generic
arbitrary-repository host.

## Authority and evidence

Approve only Worker `effect-ci-node-npm`, Workflow `effect-ci-node-npm-checks`,
Container application `effect-ci-node-npm-workspace`, its image upload and
`WorkspaceContainer` SQLite namespace, plus their execution, snapshots and logs.
The config enables no public URL, HTTP dispatcher, secrets, service bindings,
R2 bucket, Artifacts namespace or deployment broker. The trusted Cloudflare CLI
needs the account's matching deployment/Container/Workflow capabilities; no
credential is passed as a workflow parameter or installed in the workload.

Independent deployment and execution are **unverified**. Preserve
`coverage-node-npm-20261008-2` on `effect-ci-example-node-npm` as shared-host
history. Record the new source SHA, Worker and Workflow versions, image digest,
instance ID, native steps and final plan separately before claiming migration
complete. A local Worker/Container build is not a hosted run.

No cleanup runs automatically. Resource deletion needs separate approval; leave
the shared host and all retained histories unchanged.
