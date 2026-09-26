# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
             ┌─ lint ─┐
checkout → install    ├→ build
             └─ test ─┘
```

Compare:

- [`.github/workflows/pull_request.yml`](./.github/workflows/pull_request.yml): a conventional workflow based on the current [`setup-node` basic example](https://github.com/actions/setup-node#basic), intended to remain clear and copyable into a standalone repository.
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with Effect.
- [`../../.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml): the directory-matrix harness that executes this example's actual workflow and then its Effect implementation.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm
pnpm ci:node-npm
```

Both modes call `CI.runPromise` and receive the same workflow value and structured
plan. `NODE_ENV` defaults to `test` in CI and `development` elsewhere, while any
non-empty `DRY_RUN` selects planning mode.
