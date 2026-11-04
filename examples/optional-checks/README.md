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
