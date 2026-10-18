# Snapshot-backed deployment changes

Compare output against the last successfully deployed workspace snapshot:

```ts
const workspace = yield* build()
if (yield* workspace.changed("dist/**")) yield* deploy()
```

The host configures `snapshotDeployment` from
`@effect-ci-testbed/cloudflare/snapshot-deployment` with a runner, private
`SnapshotDeploymentBaselines` Durable Object, destination, patterns, serving
configuration identity and `verifyCurrent` callback. Pass `destination.changes`
as `RunOptions.workspaceChanges`. Native and GitHub-Cloudflare entrypoints also
accept a lazy `workspaceChanges(environment, context)` factory.

After its existing deployment controller publishes and verifies the target, the
deploy action calls:

```ts
const recorded = yield* destination.recordSuccessful(workspace, receipt)
```

`verifyCurrent` receives the non-secret receipt, destination, configuration,
complete selected-file manifest and digest. It must independently confirm that
the target **currently serves those bytes with that policy**, not just that a
receipt ID exists. Only literal `true` authorizes recording or skipping.

The helper does not deploy, approve, retry or roll back anything. Keep those
semantics in the existing controller. Record only final deployment success—not
build completion, a staged candidate, preview publication or a partial rollout.
Failed baseline recording returns `false` without failing successful publication;
cancellation still cancels.

## What is compared

Selected paths, SHA-256 bytes, sizes and executable bits. Destination, complete
pattern scope and serving configuration select the baseline. Commit hashes,
snapshot IDs and build timestamps do not determine output equality.

The private SQLite baseline retains the immutable snapshot handle and manifest.
Updates use generation compare-and-set; an overlapping recorder cannot overwrite
a baseline it did not observe. Prior generations are retained. This first
implementation restores both snapshots to check availability and manifest
integrity. Stored manifests allow future comparison optimizations; they do not
alone prove an artifact is still available.

Unknown state runs deployment: absent/expired snapshots, target drift, policy
changes, unsupported scopes and provider errors. Comparisons own one complete
configured pattern scope, not arbitrary subsets. They do not authorize check
reuse or bypass deployment approvals.

## Snapshot reads

`runner.outputs.inspect(workspace, patterns)` observes an immutable result owned
by the current run. Baseline reads use private saved handles, not imported JSON
workflow attempts. Each read restores into a separate inspection object, runs a
fixed isolated `/usr/bin/python3` file reader and stops that VM in `finally`.
It never marks business mutation ownership or creates a new business checkpoint.
An inspection cannot replace another action's uncheckpointed work.

Limits: 1,000 regular files, 16 MiB selected bytes, 10,000 traversed entries and
1 MiB manifest text. Symlinks and changing files are rejected. The image must
provide Python 3; it is not installed implicitly. Keep snapshot handles and
baseline RPCs private. These are host capabilities, not public HTTP endpoints.

The [deployable HTML site](../../../apps/effect-ci/verification/snapshot-site)
shows actual publication, serving-handler byte verification, idempotent replay
and final container cleanup without account-specific services or keys. It is a
small static destination, not a general Worker-bundle/canary adapter. Its
[hosted proof](../../../apps/effect-ci/verification/snapshot-site/hosted-proof.json)
retains four completed native runs: first deploy, identical bytes in a different
snapshot skip, shared-package output change deploys, repeated output skips.
Served bytes and deployment receipts were independently checked; all example
containers were stopped. Local tests additionally cover failure, drift and replay.
