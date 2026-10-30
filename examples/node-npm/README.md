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

Use the same workflow on your configured hosted runner with
`effect-ci run --remote --workflow examples/node-npm/.cloudflare/ci/workflow.ts`
from the repository root. No recipe-specific deployment is required. Remote
execution uses the clean, pushed commit, not local edits.
