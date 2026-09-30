# Node + pnpm

This example answers one question:

> How do I run the same CI shape with pnpm while keeping package-manager-specific setup
> out of the workflow orchestration?

The fixture is a dependency-free Node application whose `packageManager` field and
lockfile demonstrate JavaScript package-manager inference selecting pnpm.

Its pipeline is:

```text
checkout → install → [lint (required) ∥ format (optional)] → test → build
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

The executable `.cloudflare/workflows/ci.run.ts` exposes the same default workflow,
named action targets, text/JSON formats, and local/remote selection as the npm example;
the inferred package-manager resource is the only runtime difference.

```bash
NODE_ENV=staging pnpm ci:node-pnpm:dry-run
pnpm ci:node-pnpm
```

If this directory becomes its own repository, `.github/workflows/github.yml` is the
complete conventional GitHub Actions setup. The Effect caller currently relies on
the testbed's reusable workflow and workspace package; publishing that integration
is a later packaging step.
