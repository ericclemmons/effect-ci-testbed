# Share build artifacts between jobs

Publish build output when another workload needs to restore it.

`CI.Artifact.publish` records the selected paths and checkpoints the workspace.
`restore` retrieves it through the runner, without exposing storage-specific IDs.

## Run it

```sh
pnpm exec cf-ci run --workflow examples/portable-artifacts/.cloudflare/ci/workflow.ts
```

The example writes, publishes, and restores a small file. This adapter currently
transports the whole workspace; the selected paths remain in the plan.

For ordinary dependent actions, simply return a `CI.Workspace` instead.

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
