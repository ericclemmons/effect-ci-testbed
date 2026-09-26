# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
checkout → install → lint → test → build
```

Compare:

- [`.github/workflows/pull_request.yml`](./.github/workflows/pull_request.yml): the standalone workflow with its steps inline, based on the current [`setup-node` basic example](https://github.com/actions/setup-node#basic).
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with Effect.
- [`.e2e`](./.e2e): testbed-only adapters for the `github-actions` and `effect-on-github` matrix rows.
- [`../../.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml): the root example-by-implementation matrix.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm
pnpm ci:node-npm
```

Both modes call `CI.runPromise` and receive the same workflow value and structured
plan. `NODE_ENV` defaults to `test` in CI and `development` elsewhere, while any
non-empty `DRY_RUN` selects planning mode.
