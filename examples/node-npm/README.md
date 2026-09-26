# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
             ┌─ lint ─┐
checkout → install    ├→ build
             └─ test ─┘
```

Compare:

- [`.github/workflows/pull_request.yml`](./.github/workflows/pull_request.yml): a conventional workflow intended to remain clear, current, and copyable into a standalone repository.
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with Effect.
- [`../../.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml): the testbed workflow that mirrors the conventional jobs and runs the Effect implementation on pull requests.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm
pnpm ci:node-npm
```

The dry-run calls `CI.planPromise` and renders the returned `WorkflowPlan`. The normal
run calls `CI.runPromise`; both interpret the same exported workflow. `NODE_ENV`
defaults to `test` in CI and `development` elsewhere, while any non-empty `DRY_RUN`
enables planning.
