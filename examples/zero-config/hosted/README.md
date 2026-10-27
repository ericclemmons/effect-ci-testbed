# Host script discovery independently

This package owns the Cloudflare wrapper, source-manifest reader, config,
Container binding and image for the [zero-config fixture](../README.md).
Its package.json is separate so its hosting scripts cannot become discovered
fixture checks. No portable workflow is added to the fixture.

[Deployment config](./cloudflare.config.ts "source")

[Native wrapper](./src/worker.ts#symbol=ZeroConfigWorkflow "source")

[Manifest reader](./src/source-manifest.ts#symbol=readSourceManifest "source")

The reader copies the shared host's validation contract rather than importing
its implementation. It requires a full GitHub commit and relative fixture root,
rejects redirects and invalid script shapes, and reads the requested revision's
manifest before calling `CI.fromPackageJson`. It does not read the host manifest.

After installing repository dependencies, build the Worker bundle and local
Container image without provisioning:

```sh
cd examples/zero-config/hosted
pnpm build
```

With approval for the account, the exact resources below and a bounded paid run:

```sh
cf deploy
cf workflows instances create effect-ci-zero-config-checks --body '{"instance_id":"owned-zero-config-UNIQUE_ID","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
cf workflows instances get owned-zero-config-UNIQUE_ID --workflow-name effect-ci-zero-config-checks
```

Use the full published commit containing this host and fixture. The inferred
checkout/install/format/lint/test/build plan runs under `examples/zero-config`.
Live workspace reuse stays disabled. Manifest validation or fetch failure fails
the Workflow before checkout; action failure retains the normal Workflow error
and history. There is no public HTTP dispatcher or automatic deletion.

## Authority and evidence

Approve only Worker `effect-ci-zero-config`, Workflow `effect-ci-zero-config-checks`,
Container application `effect-ci-zero-config-workspace`, its image upload and
`WorkspaceContainer` SQLite namespace, plus their execution, snapshots and logs.
The host reads public GitHub manifests; the Container fetches source and npm
dependencies. No secrets, service bindings, R2, Artifacts or release broker are
configured. Deployment credentials stay in the trusted CLI session.

Independent deployment and execution are **unverified**. Preserve
`coverage-zero-config-20261009-3` on `effect-ci-example-zero-config` as historical
shared-host evidence. Record new source SHA, Worker and Workflow versions, image
digest, instance ID and the complete inferred plan before claiming migration
complete. A local build or plan does not satisfy hosted acceptance.

Resource deletion needs separate approval. Do not reset or rename old instances
or remove the shared host to produce a new receipt.
