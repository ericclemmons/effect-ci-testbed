# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
checkout → install → lint → test → build
```

Compare:

- [`.github/workflows/pull_request.yml`](./.github/workflows/pull_request.yml): the standalone workflow with its steps inline, based on the current [`setup-node` basic example](https://github.com/actions/setup-node#basic).
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with Effect.
- [`../../.github/workflows/node-npm-github-actions.yml`](../../.github/workflows/node-npm-github-actions.yml): the repository-root harness that stages this directory as a standalone repository and runs the conventional steps.
- [`../../.github/workflows/node-npm-effect.yml`](../../.github/workflows/node-npm-effect.yml): the separate Effect-on-GitHub check, expressed as a small call to the reusable [`effect-ci.yml`](../../.github/workflows/effect-ci.yml) workflow.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm
pnpm ci:node-npm
```

Both modes call `CI.runPromise` and receive the same workflow value and structured
plan. `NODE_ENV` defaults to `test` in CI and `development` elsewhere, while any
non-empty `DRY_RUN` selects planning mode.

The root harness is testbed infrastructure, not part of the copyable example. If this
directory becomes its own repository, its inline `.github/workflows/pull_request.yml`
is the complete conventional GitHub Actions setup.
