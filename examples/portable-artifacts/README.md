# Share build artifacts between jobs

Publish build output when another workload needs to restore it.

`CI.Artifact.publish` records the selected paths and checkpoints the workspace.
`restore` retrieves it through the runner, without exposing storage-specific IDs.
For ordinary dependent actions, simply return a `CI.Workspace` instead.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import and a checkout:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Build, then publish the output as a named artifact. The action returns a
`CI.WorkspaceArtifact`, not a download URL:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source {5-8}")

Restore the artifact in the action that needs it. `restore` returns a workspace
that contains the published files:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=deploy "source 'CI.Artifact.restore(artifact)'")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It runs the deploy, which runs the build
first:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/portable-artifacts
effect-ci run
```

The example writes, publishes, and restores a small file. This adapter currently
transports the whole workspace; the selected paths remain in the plan.

## Compare with GitHub Actions

GitHub Actions uses `upload-artifact` and `download-artifact` between two jobs:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L12-L35 "source")
