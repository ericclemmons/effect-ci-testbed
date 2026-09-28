# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
checkout → install → [lint (required) ∥ format (optional)] → test → build → deploy
```

The GitHub validation matrix and Effect parallel group express the same concurrency and
failure policy: both branches finish, but only lint blocks the later stages.

Compare:

- [`.github/workflows/github.yml`](./.github/workflows/github.yml): the standalone conventional workflow with its steps inline, based on the current [`setup-node` basic example](https://github.com/actions/setup-node#basic).
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml): the short Effect workflow that calls the testbed's reusable workflow.
- [`.cloudflare/workflows/pull-request.ts`](./.cloudflare/workflows/pull-request.ts):
  the events and orchestration for the Effect workflow.
- [`.cloudflare/actions/index.ts`](./.cloudflare/actions/index.ts): how each action
  runs and which earlier action is a true blocker.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm
pnpm ci:node-npm
```

The generic runtime loads this workflow and calls `CI.runPromise`, receiving the same
workflow value and structured plan in both modes. `NODE_ENV` defaults to `test` in CI
and `development` elsewhere, while any non-empty `DRY_RUN` selects planning mode.

The reusable Effect workflow runs both modes as separate `plan` and `execute` matrix
jobs, setting `DRY_RUN=1` in the plan job's environment.

If this directory becomes its own repository, `.github/workflows/github.yml` is the
complete conventional GitHub Actions setup. The Effect caller also needs the reusable
workflow and CI package published or copied into that repository; packaging those is
a later step.
