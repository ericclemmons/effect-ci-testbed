# Run CI with pnpm

Use pnpm without putting package-manager setup into every check. Lint is required,
formatting is advisory, and both run before test and build.

## Run it

```sh
pnpm exec cf-ci run --workflow examples/node-pnpm/.cloudflare/ci/workflow.ts test build
```

Request test, build, or both: their shared install and checks run once. Only
`lint`, `format`, `test`, and `build` are public CLI targets.

The [actions](./.cloudflare/ci/actions.ts) own these dependencies; the
[workflow](./.cloudflare/ci/workflow.ts) selects the goal.
Compare with [GitHub Actions YAML](./.github/workflows/github.yml).

## Own the Cloudflare host

The [standalone host](./hosted/README.md) keeps hosting dependencies out of this
fixture's frozen pnpm install. It owns its config, Workflow, Container binding
and Dockerfile. Independent deployment and execution remain unverified; the
old shared-host run remains separate.
