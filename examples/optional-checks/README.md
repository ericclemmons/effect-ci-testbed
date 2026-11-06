# Run required and optional checks

Run lint and formatting together, without letting advisory formatting block CI.

[Source](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/optional-checks
effect-ci run
```

Formatting deliberately fails; lint passes, so the run succeeds. Remove
`CI.optional` or fail lint and the workflow fails.

[Workflow](./.cloudflare/ci/workflow.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs lint and format in
parallel with Cloudflare Workflows `step.runner()`. Format is marked optional, so
its deliberate failure is reported without failing the run. It does not use
Effect CI.

```sh
(cd examples/optional-checks/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs optional-checks
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
