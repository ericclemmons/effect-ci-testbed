# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
checkout → install → lint → test → build
```

Compare:

- [`.github/workflows/github.yml`](./.github/workflows/github.yml): the standalone conventional workflow with its steps inline, based on the current [`setup-node` basic example](https://github.com/actions/setup-node#basic).
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml): the short Effect workflow that calls the testbed's reusable workflow.
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with Effect.
- [`../../.github/workflows/examples-node-npm-github.yml`](../../.github/workflows/examples-node-npm-github.yml): the repository-root harness that stages this directory as a standalone repository and runs the conventional steps.
- [`../../.github/workflows/examples-node-npm-effect-on-github.yml`](../../.github/workflows/examples-node-npm-effect-on-github.yml): the separate Effect-on-GitHub check, expressed as a small call to the reusable [`effect-ci.yml`](../../.github/workflows/effect-ci.yml) workflow.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm
pnpm ci:node-npm
```

Both modes call `CI.runPromise` and receive the same workflow value and structured
plan. `NODE_ENV` defaults to `test` in CI and `development` elsewhere, while any
non-empty `DRY_RUN` selects planning mode.

The root harness is testbed infrastructure. If this directory becomes its own
repository, `.github/workflows/github.yml` is the complete conventional GitHub
Actions setup. The Effect caller also needs the reusable workflow and CI package
published or copied into that repository; packaging those is a later step.
