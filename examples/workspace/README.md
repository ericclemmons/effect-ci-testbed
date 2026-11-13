# Inspect files and restore a checkpoint

Read project files through a workspace, then restore an exact revision after a
temporary edit. The source fixture stays unchanged.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the imports and a checkout that
returns the `app` directory as the workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L2 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Inspect files with `exists` and `readFile`:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=inspect "source {3,6}")

Save a checkpoint, make a temporary edit, then restore the saved revision:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=restore "source {3,5}")

Compare the source with its base revision. The result lists the changed paths,
or explains why they are unknown:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=compare "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It runs the three actions in order. The
`local` export gives the CLI a snapshot runner that copies only `app/`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {5-6}")

## Run it

```sh
cd examples/workspace
effect-ci run
```

No Docker, network, or account credentials are needed. The local snapshot runner
copies only `app/` to temporary directories; the CLI disposes them on exit,
including when the run fails. These are trusted local commands, not a sandbox.

See [CI.Source](../../packages/ci/SOURCE.md) and
[CI.Workspace](../../packages/ci/WORKSPACE.md).

## Compare with GitHub Actions

GitHub Actions has no workspace checkpoint, so an archive stands in for one:

[GitHub Actions comparison](./.github/workflows/github.yml#L11-L27 "source")
