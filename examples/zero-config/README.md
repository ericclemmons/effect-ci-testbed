# Discover actions automatically

Already have package scripts? Run them without writing a workflow.

From this example directory:

```sh
effect-ci run test build
effect-ci list
effect-ci plan --format=mermaid
effect-ci run lint
```

Every package script is an action. Vite+ tasks under `run.tasks` in
`vite.config.ts` are actions too. The CLI detects the package manager and shares
checkout and installation across the selected actions. Execution requires a name;
bare `effect-ci run` reports how to choose one. `list` and `plan` can inspect all
actions without executing them.

The first local `run` creates an empty `.cloudflare/ci/ci.ts` marker when no
workflow exists. `plan` and `list` do not create files.

Add [.cloudflare/ci/workflow.ts](../node-pnpm/.cloudflare/ci/workflow.ts) when you
need custom ordering or parallelism; it replaces script discovery.

For remote script discovery, run
`effect-ci run lint test build --remote --workflow examples/zero-config` from the repository root.
Your configured hosted service discovers scripts inside that project; it needs no
recipe-specific deployment. Remote execution uses the pushed commit and does not
create a local marker.
