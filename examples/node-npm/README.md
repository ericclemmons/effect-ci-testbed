# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
             ┌─ lint ─┐
checkout → install    ├→ build
             └─ test ─┘
```

Compare:

- [`.github/actions/vanilla/action.yml`](./.github/actions/vanilla/action.yml): the example-owned setup and command steps used by each conventional job.
- [`.github/actions/effect/action.yml`](./.github/actions/effect/action.yml): the example-owned planning and execution steps for Effect CI.
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with Effect.
- [`../../.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml): the thin root workflow that invokes this example in both modes.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm
pnpm ci:node-npm
```

The dry-run calls `CI.planPromise` and renders the returned `WorkflowPlan`. The normal
run calls `CI.runPromise`; both interpret the same exported workflow. `NODE_ENV`
defaults to `development`, while any non-empty `DRY_RUN` enables planning.
