# Effect CI testbed

> Experimental, README-driven prototype. The examples are the product spec. Most rows below are intentionally not implemented yet.

This repository asks one question:

> What does CI look like when a workflow is an Effect program, its steps are durable dependencies, and the same program can run locally, on a GitHub runner, or eventually on Cloudflare Workflows?

The goal is not to generate GitHub Actions YAML. The goal is to author the pipeline once in TypeScript and choose where it runs.

```text
                              ┌─ existing local workspace
                              ├─ temporary worktree / copy-on-write workspace
ci.workflow.ts ── runtime ────├─ GitHub or GitLab runner workspace
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

The first example describes steps 1 and 2. It owns its workflows under its own
`.github/workflows` directory: the conventional
[`github.yml`](./examples/node-npm/.github/workflows/github.yml) and the small
[`effect-on-github.yml`](./examples/node-npm/.github/workflows/effect-on-github.yml)
caller.

GitHub discovers workflow files only at the repository root, does not support nested
workflow directories, and requires literal `uses` paths for reusable workflows. That
means a root matrix cannot natively execute an arbitrary
`examples/<example>/.github/workflows/<runner>.yml` path. The testbed deliberately
does not generate root copies or interpret those files. The E2E orchestration boundary
remains open until the examples can be run as repositories or another runner is chosen.

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
| `node-pnpm` | pnpm, Corepack, frozen lockfile | ⬜ | ⬜ | ⬜ |
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

[`examples/node-npm/ci.workflow.ts`](./examples/node-npm/ci.workflow.ts) describes:

```text
checkout → install → lint → test → build
```

The important API experiment is:

```ts
import * as Effect from "effect/Effect"
import * as CI from "@effect-ci-testbed/ci"

const install = CI.step("install", function* () {
  const workspace = yield* checkout
  return yield* workspace.exec("npm ci")
})

const lint = CI.step("lint", function* () {
  const workspace = yield* install
  return yield* workspace.exec("npm run lint")
})

const test = CI.step("test", function* () {
  const workspace = yield* lint
  return yield* workspace.exec("npm test")
})
```

`CI.step` accepts a generator, an Effect, or a function returning a Promise. It does not require a separate `.async` API.

## Run it

```bash
pnpm install

# Discover the graph and commands without executing them.
DRY_RUN=1 NODE_ENV=staging pnpm ci:node-npm

# Execute the same workflow locally.
pnpm ci:node-npm

# Type-check the prototype and run both modes.
pnpm test
```

The example's conventional workflow keeps its steps inline. The Effect-on-GitHub
alternative replaces those setup and command steps with one reusable workflow call:

```yaml
jobs:
  ci:
    uses: ./.github/workflows/effect-ci.yml
    with:
      workflow: ci.run.ts
```

The reusable workflow currently represents the GitHub execution layer: checkout,
Node and pnpm setup, dependency installation, and invocation of the requested
`ci.run.ts`. The example's Effect caller shows the intended standalone shape; it
currently relies on the testbed's reusable workflow and workspace package, which
still need to be packaged for use from an independent repository. A future Cloudflare
caller should select a different execution layer while leaving the TypeScript workflow
unchanged.

The reusable workflow runs `plan` and `execute` as separate matrix jobs, so GitHub
reports both modes. It sets `DRY_RUN=1` in the plan job's environment;
`ci.run.ts` chooses the mode from that ordinary environment variable.

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
- `CI.step(id, body, options?)` is an Effect and can be yielded directly.
- Ordinary Effect composition controls execution. This example is deliberately sequential; `Effect.all` is available when an example intentionally benefits from shared-workspace concurrency.
- Repeatedly yielding the same step executes it once per run.
- A `Workspace` is the value passed between steps.
- `CI.run` has one result contract in both modes. Planning records commands as no-ops; execution runs them locally. Both return the workflow value and structured plan.
- Runtime configuration uses ordinary process environment: `NODE_ENV` defaults to `test` when `CI` is set and `development` otherwise; any non-empty `DRY_RUN` selects planning. The prototype does not introduce a CI-specific argument parser or configuration CLI.
- Dependency edges are literal yields. The first example yields the previous step to model the common single-workspace install → lint → test → build path.
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
