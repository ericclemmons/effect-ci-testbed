# Effect CI testbed

> Experimental, README-driven prototype. The examples are the product spec. Most rows below are intentionally not implemented yet.

This repository asks one question:

> What does CI look like when a workflow is an Effect program, its steps are durable dependencies, and the same program can run locally, on a GitHub runner, or eventually on Cloudflare Workflows?

The goal is not to generate GitHub Actions YAML. The goal is to author the pipeline once in TypeScript and choose where it runs.

```text
                              ┌─ existing local workspace
                              ├─ temporary worktree / copy-on-write workspace
.cloudflare/workflows/*.ts ───├─ GitHub or GitLab runner workspace
                              └─ Cloudflare Worker-backed workspace

source layer                  execution layer
────────────                  ───────────────
GitHub                        local process
GitLab                        isolated filesystem workspace
Cloudflare SCM                Cloudflare Worker executor
R2 / S3 archive               self-hosted executor
```

## Incremental adoption

```text
1. Keep the canonical GitHub Actions workflow.
2. Author the same flow with Effect and run it inside GitHub Actions.
3. Move execution to Cloudflare Workflows without rewriting the workflow.
4. Replace GitHub as the source with GitLab, Cloudflare SCM, or object storage.
```

Each example owns its workflows under its own `.github/workflows` directory: a
conventional `github.yml` and a small `effect-on-github.yml` caller. The npm and pnpm
fixtures intentionally use the normal setup for their own package manager instead of
sharing an abstract testbed action.

GitHub discovers workflow files only at the repository root, does not support nested
workflow directories, and requires literal `uses` paths for reusable workflows. The
root [`e2e.yml`](./.github/workflows/e2e.yml) therefore treats each example as a small
repository and runs its exact `.github/workflows/github.yml` with `act`. `act` is only
the testbed's GitHub-hosted E2E harness; it is not the CI runtime and developers do not
need to install or run it locally.

Direct/local-style Effect execution and Effect-on-GitHub are separate matrix-backed
checks. The local variant invokes each `.cloudflare/workflows/*.ts` directly on the GitHub machine,
the same way a developer invokes it in an existing workspace, and has no GitHub App
reporter. Effect-on-GitHub calls the root reusable
[`effect-ci.yml`](./.github/workflows/effect-ci.yml) natively, pointing it at each
example's `.cloudflare/workflows/pull-request.ts`. This keeps failures distinct and leaves room for parallel
`effect-on-gitlab` and `effect-on-cloudflare` checks without copying example-specific
commands into the root workflow.

During planning, the installed Effect CI GitHub App publishes one check containing
the ordered graph, dependencies, commands, and working directories. During execution,
the App owns one first-class check run
for every workflow step. The CI runtime emits structured lifecycle events on a
dedicated stream; the GitHub adapter turns those events into native queued, running,
success, failure, and skipped checks without adding GitHub concerns to the workflow.
Command output is tee'd to the runner and attached directly to its step's check, so
diagnostics do not require a separate Effect CI log viewer. Checks are named
`<workflow> / <stage><branch> <step>`, so GitHub's alphabetical display preserves DAG
order: sequential steps appear as `1.`, `2.`, `3.`, while parallel steps at the same
depth appear as `3a.`, `3b.`, and `3c.`. The plan is stage `0.`. Every example adds
its own independent set under the app's check suite. A later Cloudflare runner can
consume the same events and publish the same checks without pretending to be a
GitHub Actions job.

## Workspace-first execution

A run owns one workspace. Steps are dependency, durability, and observability
boundaries; they do not imply separate machines or containers. Commands reuse the
same filesystem by default, which matches how developers usually work locally and
keeps the common install → check → build → deploy path fast.

- On GitHub or GitLab, the platform-provided fresh runner becomes the workspace.
- Locally, execution may use the current checkout or an isolated temp directory,
  worktree, snapshot, or copy-on-write clone.
- On Cloudflare, the eventual executor should preserve this workspace contract rather
  than emulate hosted-runner containers.
- Separate machines, persisted snapshots, artifact transfer, and restoration are
  explicit opt-in capabilities for workflows that require isolation or fan-out.
- Workspace reuse is an optimization. Correctness may not depend on a particular
  process, machine, or executor remaining alive across a durable suspension.

## Examples

| Example | Scenario | Vanilla CI | Effect CI | Cloudflare runtime |
| --- | --- | :---: | :---: | :---: |
| [`node-npm`](./examples/node-npm) | Node, npm, lint + test, build | ✅ | ✅ | ⬜ |
| [`node-pnpm`](./examples/node-pnpm) | Node, pnpm, lint + test, build | ✅ | ✅ | ⬜ |
| `node-version` | custom Node version and architecture | ⬜ | ⬜ | ⬜ |
| `bun` | Bun install, test, and build | ⬜ | ⬜ | ⬜ |
| `workers-app` | Worker lint, tests, build | ⬜ | ⬜ | ⬜ |
| `workers-preview` | PR preview target and cleanup | ⬜ | ⬜ | ⬜ |
| `turbo` | existing Turbo graph and cache | ⬜ | ⬜ | ⬜ |
| `vite-plus` | cooperative automatic cache metadata | ⬜ | ⬜ | ⬜ |
| `monorepo` | multiple apps and affected packages | ⬜ | ⬜ | ⬜ |
| `mirrored-source` | same repository pushed from GitHub or GitLab | ⬜ | ⬜ | ⬜ |
| `manual-reconcile` | compare latest source with deployed revision | ⬜ | ⬜ | ⬜ |
| `approval` | durable human approval before deployment | ⬜ | ⬜ | ⬜ |
| `gradual-deploy` | version upload, percentages, health, rollback | ⬜ | ⬜ | ⬜ |

Heavy multi-deployment orchestration is deliberately a separate future feature. The first deployment examples should run the commands developers naturally run and capture structured tool output such as Wrangler's output file.

## First vertical slice

[`examples/node-npm/.cloudflare/workflows/pull-request.ts`](./examples/node-npm/.cloudflare/workflows/pull-request.ts)
coordinates actions from
[`examples/node-npm/.cloudflare/actions/index.ts`](./examples/node-npm/.cloudflare/actions/index.ts):

```text
checkout → install → build ┐
                   ├→ lint
                   └→ test
```

Actions describe their implementation and actual blockers:

```ts
import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"

export const install = CI.action("install", (workspace: CI.Workspace) =>
  workspace.exec("npm ci"),
)

export const lint = CI.action("lint", (workspace: CI.Workspace) =>
  workspace.exec("npm run lint"),
)

export const test = CI.action("test", (workspace: CI.Workspace) =>
  workspace.exec("npm test"),
)
```

`CI.action` accepts inputs and returns an Effect action. Workspace inputs carry the
producer identity, so the plan derives direct dependency edges without a separate
`needs` DSL.

The workflow declares its source events and coordinates sequential and parallel work:

```ts
const checks = Effect.gen(function* () {
  const repository = yield* checkout()
  const dependencies = yield* install(repository)
  return yield* Effect.all([
    build(dependencies),
    lint(dependencies),
    test(dependencies),
  ], { concurrency: "unbounded" })
})

export default CI.workflow("node-npm", checks, {
  on: ["pull_request", "push"],
})
```

## Run it

```bash
pnpm install

# Discover the graph and commands without executing them.
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm

# Execute the same workflow locally.
pnpm ci:node-npm
pnpm ci:node-pnpm

# Type-check the prototype. Behavioral verification happens in PR E2E.
pnpm check
```

The example's conventional workflow keeps its steps inline. The Effect-on-GitHub
alternative replaces those setup and command steps with one reusable workflow call:

```yaml
jobs:
  ci:
    uses: ./.github/workflows/effect-ci.yml
    with:
      workflow: .cloudflare/workflows/pull-request.ts
```

The reusable workflow currently represents the GitHub execution layer: checkout,
Node and pnpm setup, dependency installation, and invocation of the requested
workflow module. In execute mode it also installs an app token and wraps the portable CI
program with the GitHub reporting adapter. The example's Effect caller shows the
intended standalone shape; it currently relies on the testbed's reusable workflow
and workspace packages, which still need to be packaged for use from an independent
repository. A future Cloudflare caller should select different execution and reporting
layers while leaving the TypeScript workflow unchanged.

The reusable workflow runs `plan` and `execute` as separate matrix jobs, so GitHub
reports both modes. It sets `DRY_RUN=1` in the plan job's environment;
the generic runtime chooses the mode from that ordinary environment variable.

`CI.run(workflow, { mode })` is the interpreter boundary in the prototype. Both modes
run the same dependency-yielding Effect program with hydrated values and return the
same `{ value, plan }` contract. Planning suppresses workspace commands; execution
runs them:

```ts
const result = await CI.runPromise(workflow, {
  mode: process.env.DRY_RUN ? "plan" : "execute",
})
```

The plan contains topologically ordered nodes, direct `needs` edges, commands,
working directories, durable step options, and status. It is intended to feed the
eventual DAG visualizer and permission audit without introducing a separate workflow
definition or planning DSL.

## Current prototype semantics

- `import * as CI` follows Effect's module style and keeps provider implementations out of the core package.
- `CI.action(id, body, options?)` defines reusable work; calling it with typed inputs returns an Effect that can be yielded directly.
- `CI.step(id, body, options?)` remains the lower-level fixed-step primitive.
- Ordinary Effect composition controls execution. The examples install sequentially, then use `Effect.all` to run build, lint, and test concurrently in the shared workspace.
- Repeatedly yielding the same step executes it once per run.
- A `Workspace` is the value passed between steps.
- `CI.run` has one result contract in both modes. Planning records commands as no-ops; execution runs them locally. Both return the workflow value and structured plan.
- Runtime configuration uses ordinary process environment: `NODE_ENV` defaults to `test` when `CI` is set and `development` otherwise; any non-empty `DRY_RUN` selects planning. The prototype does not introduce a CI-specific argument parser or configuration CLI.
- Dependency edges follow action inputs and outputs. The installed workspace is passed to build, lint, and test, so each directly needs install and none incorrectly depends on another check passing.
- JavaScript chooses branches, targets, modes, and preview names. There is no condition DSL.
- Durable retry options will use the Cloudflare `WorkflowStepConfig` shape. Effect `Schedule` is not accepted as step configuration.
- The default executor is workspace-first, not job-container-first. Distributed steps and artifact transfer are explicit later capabilities.

## Runtime boundary

The prototype currently has one in-process runtime. The intended production split is:

```text
CI program
  └─ CI.run
       ├─ mode plan: hydrate values and record commands
       ├─ mode execute: run commands on the local/GitHub host
       └─ future Cloudflare Layer: map CI.step to durable Workflow steps
```

This slice deliberately stops at a first-class plan rather than adding planner unit
tests or a second engine. Verification remains end to end: type-check the packages,
dry-run the real example, then execute that same example against its fixture app.

Cloudflare mode should keep ordinary Effect composition. The Workflow step is the durable boundary; the workflow does not need an Alchemy-style outer construction function merely to discover dependencies.

Target concurrency will likely require a Durable Object keyed by target. Workflows can call Durable Objects through bindings, so a separate scheduler service is not inherently required. Cancellation must stop only work declared safe to interrupt; deployments and other external side effects enter a non-cancellable or compensating phase.

## What Effect must prove

This repository should make the delta visible rather than merely claiming that Effect is better:

- typed success, failure, and requirements;
- dependencies expressed by yielding values;
- structured concurrency with `Effect.all`;
- Layers for source, executor, notifications, and test implementations;
- deterministic test services and clocks;
- typed errors and recovery;
- resource scopes and interruption safety;
- the same program interpreted for dry-run and durable execution;
- an async façade over the same engine rather than a second implementation.

## Prototype status

The code is intentionally small and disposable. Once the first examples settle the API, the learned contract should move into an ADR before the runtime grows production concerns.
