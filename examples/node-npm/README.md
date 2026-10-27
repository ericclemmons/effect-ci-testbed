# Run CI with npm

Write checkout, install, lint, test, and build once, then run the same workflow
locally or in CI. The lockfile selects npm automatically.

[Source](./.cloudflare/ci/actions.ts#symbol=install "source")

## Run it

```sh
pnpm exec cf-ci run --workflow examples/node-npm/.cloudflare/ci/workflow.ts
```

[Actions](./.cloudflare/ci/actions.ts) declare their own prerequisites: build
depends on test, which depends on lint. Shared installation runs once.

Compare the [Effect workflow](./.cloudflare/ci/workflow.ts) with
[GitHub Actions YAML](./.github/workflows/github.yml).

## Own the Cloudflare host

The [standalone host](./hosted/README.md) owns its config, Workflow, Container
binding and Dockerfile. Its dependencies are separate from this npm fixture.
It has not been deployed or run independently; the old shared-host run is not
standalone evidence.
