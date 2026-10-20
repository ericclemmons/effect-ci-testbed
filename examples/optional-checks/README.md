# Run required and optional checks

Run lint and formatting together, without letting advisory formatting block CI.

```ts
yield* CI.parallel([
  actions.lint(),
  CI.optional(actions.format()),
])
```

## Run it

```sh
pnpm exec cf-ci run --workflow examples/optional-checks/.cloudflare/ci/workflow.ts
```

Formatting deliberately fails; lint passes, so the run succeeds. Remove
`CI.optional` or fail lint and the workflow fails.

[Workflow](./.cloudflare/ci/workflow.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
