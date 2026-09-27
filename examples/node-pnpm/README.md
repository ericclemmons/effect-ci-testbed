# Node + pnpm

This parity fixture is a dependency-free Node application using pnpm.

Its pipeline is:

```text
checkout → install → lint → test → build
```

Compare:

- [`.github/workflows/github.yml`](./.github/workflows/github.yml): a standalone
  conventional workflow using the current all-in-one [`pnpm/setup`](https://github.com/pnpm/setup)
  action.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml):
  the small Effect workflow caller.
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with
  Effect.

```bash
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-pnpm
pnpm ci:node-pnpm
```

If this directory becomes its own repository, `.github/workflows/github.yml` is the
complete conventional GitHub Actions setup. The Effect caller currently relies on
the testbed's reusable workflow and workspace package; publishing that integration
is a later packaging step.
