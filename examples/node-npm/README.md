# Node + npm

The first parity fixture is deliberately ordinary: a dependency-free Node application using npm.

Its pipeline is:

```text
             ┌─ lint ─┐
checkout → install    ├→ build
             └─ test ─┘
```

Compare:

- [`../../.github/workflows/node-npm-vanilla.yml`](../../.github/workflows/node-npm-vanilla.yml): conventional GitHub Actions jobs.
- [`ci.workflow.ts`](./ci.workflow.ts): the same dependency structure authored with Effect.
- [`../../.github/workflows/node-npm-effect.yml`](../../.github/workflows/node-npm-effect.yml): runs the Effect workflow on a GitHub-hosted runner.

```bash
pnpm ci:node-npm:dry-run
pnpm ci:node-npm
```
