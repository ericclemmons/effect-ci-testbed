# Node + pnpm

This parity fixture is a dependency-free Node application using pnpm.

Its pipeline is:

```text
checkout → install → [lint (required) ∥ format (optional)] → test → build → deploy
```

The GitHub validation matrix and Effect parallel group express the same concurrency and
failure policy: both branches finish, but only lint blocks the later stages.

Compare:

- [`.github/workflows/github.yml`](./.github/workflows/github.yml): a standalone
  conventional workflow using the current all-in-one [`pnpm/setup`](https://github.com/pnpm/setup)
  action.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml):
  the small Effect workflow caller.
- [`.cloudflare/workflows/pull-request.ts`](./.cloudflare/workflows/pull-request.ts):
  the events and orchestration for the Effect workflow.
- [`.cloudflare/actions/index.ts`](./.cloudflare/actions/index.ts): how each action
  runs and which earlier action is a true blocker.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-pnpm
pnpm ci:node-pnpm
```

If this directory becomes its own repository, `.github/workflows/github.yml` is the
complete conventional GitHub Actions setup. The Effect caller currently relies on
the testbed's reusable workflow and workspace package; publishing that integration
is a later packaging step.
