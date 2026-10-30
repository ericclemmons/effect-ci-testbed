# Local runners

`makeRunner({ image, root?, engine? })` runs commands in one local Docker
container using a mounted workspace. It does not provide immutable snapshots.

[Container runner](./src/index.ts#symbol=makeRunner "source")

## File snapshots

The `@effect-ci-testbed/local-container/snapshots` entrypoint exports
`makeSnapshotRunner({ root, paths }): CI.RunConfiguration`. Use it when a local
workflow needs independent working copies of one immutable revision. It runs
trusted commands on the host; it is not a container or security sandbox.

[Snapshot runner](./src/snapshots.ts#symbol=makeSnapshotRunner "source")

[Workflow configuration](../../examples/turbo-distributed/.cloudflare/ci/workflow.ts#symbol=local "source")

- `root` is the project directory; `paths` explicitly selects relative directories
  to copy. Other project files are not included. Selected directories cannot be
  symlinks, and links inside them must resolve within that selected directory.
- The initial copy omits `.git`, `node_modules`, `.turbo`, `.effect-ci`, and
  `dist` entries. Subsequent snapshots retain installed dependencies, build
  outputs, and caches. Regular files and directories are supported; other file
  types are rejected. Copy-on-write clones are requested where supported.
- Workspace revisions belong to one runner instance. Each action/revision pair
  gets its own working copy. Commits/checkpoints capture new immutable copies;
  restoration chooses an existing snapshot. It does not merge sibling writes.
- Command output calls the executor's `onOutput` callback. Cancellation kills
  the owned shell process group. `dispose()` stops active commands, awaits their
  exit, and deletes all owned copies. The CLI calls it in `finally`; direct SDK
  callers must do the same. Temporary storage remains allocated until disposal.

This is a local development runner. It does not publish artifacts, retain caches
across invocations, provision compute, or reproduce hosted Container performance.
