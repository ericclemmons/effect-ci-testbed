# Discover actions automatically

Already have package scripts? Run them without writing a workflow.

From this example directory:

```sh
effect-ci run test build
effect-ci list
effect-ci plan --format=mermaid
effect-ci run lint
```

Every package script is an action. Run `effect-ci run build` twice: the second
run replays the cached result. `build`, `test`, `lint`, `check` and `typecheck`
scripts run with `vp run --cache`, so Vite+ learns their inputs and outputs from
the files they read and write. Other scripts, such as `format`, always run. Vite+ tasks under `run.tasks` in
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

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) reads the package scripts in
a discovery step and runs each one as its own parallel check after `npm ci`. No
list of checks is written into the pipeline. It does not use Effect CI.

```sh
(cd examples/zero-config/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs zero-config
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
