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
checkout → install ┬→ build → deploy
                   ├→ lint
                   └→ test
```

Actions describe their implementation and actual blockers:

```ts
import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action<CI.Workspace>("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout(app)
})

export const install = CI.action<Installation>("install", () => function* () {
  const workspace = yield* checkout()
  const packageManager = yield* CI.PackageManager.JavaScript(workspace)
  return {
    packageManager: packageManager.name,
    workspace: yield* packageManager.install({ frozenLockfile: true }),
  }
})

export const lint = CI.action<CI.Workspace>("lint", () => function* () {
  const installation = yield* install()
  const packageManager = yield* CI.PackageManager.JavaScript(installation.workspace)
  return yield* packageManager.run("lint")
})

export const test = CI.action<CI.Workspace>("test", () => function* () {
  const installation = yield* install()
  const packageManager = yield* CI.PackageManager.JavaScript(installation.workspace)
  return yield* packageManager.run("test")
})

export const deploy = CI.action<Deployment>("deploy", () => function* () {
  const artifacts = yield* build()
  yield* artifacts.installation.workspace.exec("echo pnpx cf deploy")
  return { artifacts, target: "cloudflare" }
})
```

An action's construction generator resolves action-specific dependencies and returns
the durable implementation. The implementation yields prerequisite actions before doing
its own work, so invalid compositions are not expressible through the public action API:
`lint()` always installs, and `deploy()` always yields `build()` to obtain
its artifacts. The planner observes those yielded actions directly and derives `needs`
edges without a separate dependency DSL or AST parsing. Repeated action calls share one
cached result per run. The returned implementation can be an ordinary function,
generator, async function, or Effect-returning function. Construction that does not
yield services can be `() => handler`; it does not need to be a generator.
`Effect.fn` is an optional instrumentation tool, not part of the `CI.action` contract.
The explicit success generic, such as `CI.action<Deployment>`, is the action's public
output contract and checks every implementation return path. A local
`value satisfies Deployment` only checks that expression while preserving its narrower
inferred type. Effect itself orders its type parameters as success, error, and
requirements; the prototype currently exposes the success contract explicitly and
still erases action errors and requirements to `unknown` at the public boundary.

The workflow itself is only orchestration: sequential yields, parallel composition,
and per-action error handling:

```ts
import * as actions from "../actions/index.ts"

export default CI.workflow("node-npm", function* () {
  const event = yield* CI.WorkflowEvent
  if (!["pull_request", "push", "workflow_dispatch"].includes(event.type)) {
    return
  }

  yield* actions.lint()
  yield* actions.test()
  yield* actions.build()
  return yield* actions.deploy()
})
```

These ordinary yields deliberately match the single canonical GitHub job: a lint
failure stops test, build, and deploy. Parallelism belongs in the workflow only when
the GitHub equivalent also fans those checks out. Mandatory dependencies remain inside
the actions, so a separate release workflow may request only `deploy()` and still get
checkout, install, and build.

Planning follows the same workflow composition and resolves each action's dependencies,
while the planning implementation records durable execution instead of performing it.
External I/O belongs in the returned action implementation or behind a runner-provided
service so planning stays side-effect free.

The runner provides every incoming event as `CI.WorkflowEvent`. The workflow yields that
requirement and uses ordinary TypeScript to decide whether and how it applies. There is
no separate trigger-condition DSL or runner-side `on` filtering.

## Programming model

### Actions, values, and services

Actions own their mandatory prerequisites. `install` yields `checkout`; build, lint,
and test each yield `install`. Workflows choose terminal goals and coordinate optional
work, but cannot accidentally bypass the prerequisites encoded by those goals. A tagged
release workflow may request only `deploy()`; `deploy` must yield `build()`, whose typed
artifact output is its input, and `build` must yield `install()`.

Returned values carry real data rather than hidden planning metadata. A `Workspace` is
the checkout used by commands; `Installation`, `BuildArtifacts`, and `Deployment` make
the transitions type-checked. The plan edge comes from yielding the prerequisite action
itself.

`CI.PackageManager.JavaScript(workspace)` yields a workspace-bound package-manager
capability with `install`, `run`, and `exec` methods. It prefers
`package.json#packageManager`, falls back to JavaScript lockfiles, and rejects ambiguous
lockfiles. Its cardinality is **exactly one JavaScript package manager**: zero matches
and multiple JavaScript ecosystems are errors. The namespace is ecosystem-specific
because one repository may independently yield one JavaScript manager and one Python
manager for the same checkout—for example pnpm and uv. Future resource APIs must name
their cardinality rather than hide it: an optional lookup returns zero-or-one, an
ecosystem lookup returns exactly one, and a repository-wide aggregate may return many
or install all discovered managers. `packageManager.install({ frozenLockfile: true })`
maps the shared intent to each manager's native command. `workspace.exec` remains the
command escape hatch.

`checkout` does not branch on `NODE_ENV`. Application environment and workspace
acquisition are independent choices: a production build can run in an existing local
checkout, while a development build can run in a fresh remote sandbox. Instead, the
action yields `CI.Source`, and the runner supplies its implementation:

- the local source reuses the requested directory;
- the current GitHub runner reuses the directory prepared by `actions/checkout`;
- a packaged GitHub runner can replace that bootstrap with its own authenticated clone;
- a future Cloudflare source can resolve the event's repository and revision into a
  sandbox or persisted workspace snapshot.

Planning uses a non-mutating source implementation that returns a symbolic or local
workspace reference. Execution uses the runner's concrete source implementation.
This keeps source credentials and GitHub-specific environment variables out of the
portable workflow.

Effect services and Layers are for stable capabilities used to implement actions:
the command runner, cache, GitHub client, credentials, artifact store, healer agent,
approval service, and notification reporters. Those dependencies are yielded while
constructing an action and captured by its returned durable implementation.

Keeping these separate avoids a mutable ambient workspace while still allowing each
runner to provide its own implementations:

```ts
export const lint = CI.action("lint", function* () {
  const runner = yield* Runner

  return (workspace: CI.Workspace) => runner.exec(workspace, "npm run lint")
})
```

An eventual bound-workspace convenience could make this read as `workspace.lint`, but
it must preserve yielded action prerequisites rather than hiding mutable state in a
Layer.

### Where control flow belongs

- Use sequential `yield*` when later work needs an earlier value.
- Use `Effect.all` for work that can run concurrently.
- Use ordinary `if` / `switch` statements for event- or result-dependent branches.
- Use `pipe` for policy local to one action: retry, timeout, typed recovery,
  instrumentation, healing, or approval.
- Use `Effect.catchTag`, `Effect.match`, or `Effect.result` for typed failures. JavaScript
  `try` / `catch` is reserved for genuinely thrown JavaScript exceptions at integration
  boundaries, not normal Effect failures.
- Parse structured tool output at the action boundary with a Schema. The workflow
  should receive typed diagnostics rather than scrape terminal text.

Optional work is therefore ordinary code:

```ts
if (event.type === "pull_request") {
  yield* actions.preview()
}
```

### Independent checks and aggregate failure

The first fixture is sequential and fail-fast because its canonical GitHub workflow is
one sequential job. A workflow that intentionally defines independent GitHub jobs can
use Effect 4's failure-accumulating `validate` to run all of them:

```ts
return yield* Effect.validate(
  [
    actions.build().pipe(Effect.asVoid),
    actions.lint().pipe(Effect.asVoid),
    actions.test().pipe(Effect.asVoid),
  ],
  (check) => check,
  { concurrency: "unbounded", discard: true },
)
```

`Effect.validate` executes every check and accumulates all typed failures. `Effect.orDie`
is intentionally not used here: it turns typed failures into defects, which makes
recovery, reporting, and per-check GitHub conclusions harder.

`Effect.asVoid` in that heterogeneous example erases each success value so all array
members share one success type. The mapper `(check) => check` is the identity function
that turns each array element into the Effect to validate. `discard: true` avoids
building a success-value array when only completion and accumulated failures matter.
Those are Effect composition choices, not requirements of `CI.workflow`. A non-blocking
formatter should instead report a typed warning (and optionally an artifact or suggested
patch) without failing the gate that subsequent stages depend on.

### Healing and approval

When a tool offers structured output, its validation action should decode that output
into typed diagnostics. That may include tool-provided fix metadata, but the programming
model does not assume every failure can identify a safe automatic fix. Unstructured or
ambiguous failures can fall back to an agent-generated candidate or a plain failure.

Recovery actions are separate durable invocations so GitHub and Cloudflare can report
`lint`, `lint/fix`, and `lint/verify` independently:

```ts
const lint = actions.lint().pipe(
  Effect.catchTag("LintFailure", (failure) =>
    actions.healLint(failure),
  ),
)
```

`healLint` can choose a deterministic tool fix when the decoded diagnostics support it,
or resolve a lint-specific agent, model, prompt, and skills. Test and build healers can
make different choices. Safe changes should be accumulated in the workspace and verified
before one final commit-and-push action. Experimental changes become GitHub suggestions
or a candidate branch and pass through an explicit approval action before mutation or
deploy.

Action definition identity and invocation identity are distinct: `lint` names reusable
behavior, while `lint`, `lint/fix`, and `lint/verify` name durable invocations in one run.
The prototype still needs to model invocation identity explicitly before implementing
healing and re-verification.

### Workflow boundaries and new events

A recovery action runs inside the current workflow instance; it does not implicitly
fork another workflow. Applying a patch only changes that instance's isolated workspace.
The same workflow can verify the repaired workspace and then publish at most one commit,
candidate branch, or suggestion.

- Creating a GitHub suggestion emits no repository event. If a person applies it later,
  the resulting commit triggers normal CI.
- Pushing a repair commit triggers GitHub `push` and, for an open pull request,
  `pull_request.synchronize`. Those events start a fresh workflow instance that verifies
  the actual new commit from a clean workspace.
- Waiting for approval can suspend and resume the same durable workflow instance. An
  approval does not need a child workflow merely to continue execution.
- An explicitly independent or long-running operation may eventually use a child
  workflow, but that is an orchestration choice rather than the default action behavior.

Self-generated commits need loop protection: record the originating run and attempt,
deduplicate by commit SHA and external check ID, ignore already-healed commits when
appropriate, and cap repair attempts. The original run should conclude with the candidate
it produced; the event-driven run owns verification of the published commit.

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

Today those `needs` edges describe mandatory action prerequisites, not every temporal
ordering choice made by a workflow. For example, sequentially yielding lint and then
test does not make test intrinsically require lint. A scheduling layer must record that
orchestration separately before the plan UI can label serial and parallel lanes without
conflating policy order with reusable action dependencies.

## Current prototype semantics

- `import * as CI` follows Effect's module style and keeps provider implementations out of the core package.
- `CI.action(id, construction, options?)` resolves service dependencies and returns a durable implementation; that implementation yields mandatory prerequisite actions and returns typed outputs.
- `CI.step(id, body, options?)` remains the lower-level fixed-step primitive.
- Ordinary Effect composition controls execution. The current examples use sequential yields to match their canonical GitHub jobs and fail early; their yielded prerequisites independently enforce checkout → install → build → deploy.
- Repeatedly yielding the same step executes it once in the current in-process runtime. The future Cloudflare adapter must map the same stable action ID to one durable Workflow task so the persisted result is reused across replay and restart.
- A `Workspace` is the checkout shared by workspace actions. It does not carry hidden dependency metadata.
- `CI.Source` selects how that workspace is acquired. The default local source reuses
  the supplied directory; hosted and durable runners can provide different source
  implementations without branching on `NODE_ENV` inside the workflow.
- `CI.WorkflowEvent` is a yielded runtime requirement. Workflows branch on its typed
  event data directly instead of declaring an `on` array interpreted by the runner.
- `CI.PackageManager.JavaScript(workspace)` resolves exactly one npm, pnpm, Yarn, or Bun
  resource for a workspace. Other ecosystems will use independent resources, and future
  zero/one/many APIs must make their cardinality explicit.
- `CI.run` has one result contract in both modes. Planning records commands as no-ops; execution runs them locally. Both return the workflow value and structured plan.
- Runtime configuration uses ordinary process environment: `NODE_ENV` defaults to `test` when `CI` is set and `development` otherwise; any non-empty `DRY_RUN` selects planning. The prototype does not introduce a CI-specific argument parser or configuration CLI.
- Dependency edges follow yielded prerequisite actions. Build, lint, and test each yield the cached install action; deploy yields the cached build action and consumes its typed artifacts.
- JavaScript chooses branches, targets, modes, and preview names. There is no condition DSL.
- Ordinary Effect error composition attaches retry, deterministic repair, agent healing,
  notification, or approval behavior to an individual action instead of forcing one
  recovery policy over the whole workflow.
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

### Local Cloudflare verification

Direct execution remains the fast local development path because it exercises the
portable workflow without requiring a Cloudflare emulator. Once the Cloudflare adapter
wraps that program in a real `WorkflowEntrypoint`, a second E2E runner should start
[`wrangler dev`](https://developers.cloudflare.com/workflows/build/local-development/)
and use `wrangler workflows trigger <name> --local`. That runner will
verify the Cloudflare-specific interpreter: durable step caching, suspension and resume,
bindings, retries, event delivery, and workspace restoration. It complements direct
execution rather than replacing it.

Cloudflare's local Workflow environment is emulated, so remote execution remains the
final parity check for platform behavior. Local Explorer and Cloudflare's
[Workflow visualizer](https://developers.cloudflare.com/workflows/build/visualizer/)
should become useful diagnostics for this runner, especially when approval,
sleep, retry, and recovery steps are introduced.

Cloudflare mode should keep ordinary Effect composition. The Workflow step is the durable boundary; the workflow does not need an Alchemy-style outer construction function merely to discover dependencies.

The prototype's current `Workspace` still contains an in-process `cwd`; that is not a
durable Cloudflare representation. A durable runner must serialize a workspace reference
containing at least the source revision and a restorable snapshot, lease, or content
address. After every action that mutates files, the runner returns the next reference.
If a container or sandbox disappears during suspension, the executor restores that
reference before continuing. Local and GitHub implementations may optimize the same
contract by retaining one directory, but workflow correctness cannot depend on that
directory surviving.

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
