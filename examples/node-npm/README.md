# Run CI with npm

Write checkout, install, lint, test, and build once, then run the same workflow
locally or in CI. The lockfile selects npm automatically.

```ts
const workspace = yield* checkout()
const npm = yield* CI.PackageManager.JavaScript(workspace)
return yield* npm.install()
```

## Run it

```sh
pnpm exec cf-ci run --workflow examples/node-npm/.cloudflare/ci/workflow.ts
```

[Actions](./.cloudflare/ci/actions.ts) declare their own prerequisites: build
depends on test, which depends on lint. Shared installation runs once.

Compare the [Effect workflow](./.cloudflare/ci/workflow.ts) with
[GitHub Actions YAML](./.github/workflows/github.yml).
