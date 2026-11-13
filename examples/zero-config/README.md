# Discover actions automatically

Already have package scripts? Run them without writing a workflow.

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with your package scripts

Every package script is an action. This project has four:

[`package.json`](./package.json#json=scripts "source")

Vite+ tasks under `run.tasks` in `vite.config.ts` are actions too. The CLI
detects the package manager and shares checkout and installation across the
selected actions.

## Run them

From this example directory:

```sh
effect-ci run test build
effect-ci list
effect-ci plan --format=mermaid
effect-ci run lint
```

Execution requires a name; bare `effect-ci run` reports how to choose one.
`list` and `plan` can inspect all actions without executing them.

The first local `run` creates an empty `.cloudflare/ci/ci.ts` marker when no
workflow exists. `plan` and `list` do not create files.

Add [.cloudflare/ci/workflow.ts](../node-pnpm/.cloudflare/ci/workflow.ts) when you
need custom ordering or parallelism; it replaces script discovery.

## Run remotely

For remote script discovery, run
`effect-ci run lint test build --remote --workflow examples/zero-config` from the repository root.
Your configured hosted service discovers scripts inside that project; it needs no
recipe-specific deployment. Remote execution uses the pushed commit and does not
create a local marker.

## Compare with GitHub Actions

In GitHub Actions, each script needs its own step:

[GitHub Actions comparison](./.github/workflows/github.yml#L11-L24 "source")
