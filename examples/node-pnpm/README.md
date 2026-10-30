# Run CI with pnpm

Use pnpm without putting package-manager setup into every check. Lint is required,
formatting is advisory, and both run before test and build.

## Run it

```sh
cd examples/node-pnpm
effect-ci run test build
```

Request test, build, or both: their shared install and checks run once. Only
`lint`, `format`, `test`, and `build` are public CLI targets.

The [actions](./.cloudflare/ci/actions.ts) own these dependencies; the
[workflow](./.cloudflare/ci/workflow.ts) selects the goal.
Compare with [GitHub Actions YAML](./.github/workflows/github.yml).
