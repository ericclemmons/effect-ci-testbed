# CI.Workspace

A workspace carries a project directory and, when the runner supports it, a
revision. Use its methods so local and hosted runners can supply the same file
and command operations. Passing a workspace from one action to another preserves
its dependency lineage.

[Run the local example](../../examples/workspace)

## changed

`workspace.changed(patterns)` compares deployable bytes with the host-selected
successful deployment baseline. It returns `true` when that comparison is
unavailable. Source changes and built-output changes answer different questions.

[Compare built output](../../examples/deploy-changed-output/.cloudflare/ci/workflow.ts#symbol=default "source")

## checkpoint

`workspace.checkpoint(name)` captures a revision before temporary work. It returns
a `WorkspaceCheckpoint`. The runner must provide workspace persistence; the
default local filesystem alone cannot create checkpoints.

[Save, edit, and restore](../../examples/workspace/.cloudflare/ci/actions.ts#symbol=restore "source")

## directory

`workspace.directory(path)` returns a workspace rooted at a relative subdirectory.
It keeps the workspace identity and revision. Absolute paths and `..` are rejected.
Use it to run project-relative commands in a monorepo.

[Select a directory](../../examples/workspace/.cloudflare/ci/actions.ts#symbol=checkout "source")

## exec

`workspace.exec(command)` runs a shell command through the runner and returns a
workspace. A nonzero exit fails the action with command diagnostics. A missing
execution result is an unknown outcome, not proof the command did not run.

[Run a command](../../examples/local-container/.cloudflare/ci/actions.ts#symbol=verifyContainer "source")

[Local container](../../examples/local-container)

## exists

`workspace.exists(path)` checks for a relative file through the runner. Use it for
optional project configuration or to report a useful error before reading a
required input. It returns a boolean; provider errors can still fail the action.

[Check and read a required file](../../examples/workspace/.cloudflare/ci/actions.ts#symbol=inspect "source")

## readFile

`workspace.readFile(path)` returns text or `undefined` when the file is missing.
It works through the runner's filesystem capability, so hosted code does not
need a host-local path. Absolute paths and `..` are rejected.

[Read project input](../../examples/workspace/.cloudflare/ci/actions.ts#symbol=inspect "source")

## restore

`checkpoint.restore()` returns the saved workspace revision. It does not undo
network requests, deployments, or other external side effects. Restoration can
fail if the runner cannot access the saved revision.

[Checkpoint example](../../examples/workspace) · [Snapshot runner](../local-container)
