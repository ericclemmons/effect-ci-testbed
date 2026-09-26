# Effect CI testbed

> Experimental, README-driven prototype. The examples are the product spec. Most rows below are intentionally not implemented yet.

This repository asks one question:

> What does CI look like when a workflow is an Effect program, its steps are durable dependencies, and the same program can run locally, on a GitHub runner, or eventually on Cloudflare Workflows?

The goal is not to generate GitHub Actions YAML. The goal is to author the pipeline once in TypeScript and choose where it runs.

```text
                              ┌─ local process
                              ├─ GitHub runner
ci.workflow.ts ── runtime ────├─ GitLab runner
                              └─ Cloudflare Workflow + Sandbox

source layer                  execution layer
────────────                  ───────────────
GitHub                        local process
GitLab                        local container
Cloudflare SCM                Cloudflare Sandbox
R2 / S3 archive               self-hosted executor
```

## Incremental adoption

```text
1. Keep the canonical GitHub Actions workflow.
2. Author the same flow with Effect and run it inside GitHub Actions.
3. Move execution to Cloudflare Workflows without rewriting the workflow.
4. Replace GitHub as the source with GitLab, Cloudflare SCM, or object storage.
```

The first checked example proves steps 1 and 2 only.

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
             ┌─ lint ─┐
checkout → install    ├→ build
             └─ test ─┘
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

const checks = Effect.all({ lint, test }, { concurrency: "unbounded" })
```

`CI.step` accepts a generator, an Effect, or a function returning a Promise. It does not require a separate `.async` API.

## Run it

```bash
pnpm install

# Discover the graph and commands without executing them.
pnpm ci:node-npm:dry-run

# Execute the same workflow locally.
pnpm ci:node-npm

# Type-check the prototype and run both modes.
pnpm test
```

The Effect-authored GitHub workflow invokes the same `pnpm ci:node-npm` command. The vanilla workflow remains beside it as the parity oracle.

## Current prototype semantics

- `import * as CI` follows Effect's module style and keeps provider implementations out of the core package.
- `CI.step(id, body, options?)` is an Effect and can be yielded directly.
- `Effect.all` expresses concurrency; there is no CI-specific parallel abstraction yet.
- Repeatedly yielding the same step executes it once per run.
- A `Workspace` is the value passed between steps.
- `--dry-run` uses the same runtime and services. Commands are recorded as no-ops rather than swapping every Layer.
- JavaScript chooses branches, targets, modes, and preview names. There is no condition DSL.
- Durable retry options will use the Cloudflare `WorkflowStepConfig` shape. Effect `Schedule` is not accepted as step configuration.
- A live container may be reused, but correctness must eventually depend on a persisted workspace snapshot rather than container lifetime.

## Runtime boundary

The prototype currently has one in-process runtime. The intended production split is:

```text
CI program
  ├─ planning mode: execute the program with commands recorded as no-ops
  ├─ local/GitHub mode: execute commands on the host runner
  └─ Cloudflare mode: map CI.step to durable Workflow steps
```

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
