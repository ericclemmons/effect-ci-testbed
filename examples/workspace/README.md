# Inspect files and restore a checkpoint

Read project files through a workspace, then restore an exact revision after a
temporary edit. The source fixture stays unchanged.

[File inspection](./.cloudflare/ci/actions.ts#symbol=inspect "source")

[Checkpoint and restore](./.cloudflare/ci/actions.ts#symbol=restore "source")

## Run it

```sh
pnpm exec effect-ci run --workflow examples/workspace/.cloudflare/ci/workflow.ts
```

No Docker, network, or account credentials are needed. The local snapshot runner
copies only `app/` to temporary directories; the CLI disposes them on exit,
including when the run fails. These are trusted local commands, not a sandbox.

[Runner configuration](./.cloudflare/ci/workflow.ts#symbol=local "source")

[CI.Source](../../packages/ci/SOURCE.md) · [CI.Workspace](../../packages/ci/WORKSPACE.md)
