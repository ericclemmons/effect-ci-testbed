# Share build artifacts between jobs

Publish build output when another workload needs to restore it.

`CI.Artifact.publish` records the selected paths and checkpoints the workspace.
`restore` retrieves it through the runner, without exposing storage-specific IDs.

## Run it

```sh
cd examples/portable-artifacts
effect-ci run
```

The example writes, publishes, and restores a small file. This adapter currently
transports the whole workspace; the selected paths remain in the plan.

For ordinary dependent actions, simply return a `CI.Workspace` instead.

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) writes `dist/worker.js` in a
build step and saves it as a `step.runner()` output. The deploy step restores
only that file, without the checkout, like `download-artifact`. It does not use
Effect CI.

```sh
(cd examples/portable-artifacts/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs portable-artifacts
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
