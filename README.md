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

These are adoption paths, not a required migration sequence. The CI program is the
product; GitHub Actions, an agent's machine, an ephemeral GitHub runner, and a native
Cloudflare Workflow are hosts for the same program.

```text
                         repository CI program
                  .cloudflare/workflows/ci.run.ts
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
      developer / agent     GitHub Actions job    repository webhook
       executes locally       invokes program      invokes program
             │                     │                     │
       local processes       selected runner       Cloudflare Workflow
                              ├─ GitHub-hosted             │
                              └─ ephemeral custom       Container Durable Object
```

GitHub's [`runs-on`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
array matches a runner that already has **all** requested labels. A label can look like
a provisioning query—`cpu=16`, `image=linux-x64`, or eventually
`effect-ci=cloudflare`—but GitHub does not interpret those constraints itself. A runner
controller must observe the queued job, provision and register a matching ephemeral
runner, and remove it afterward. That makes a label-driven Cloudflare runner a useful
hybrid adapter, separate from Cloudflare receiving repository events and running CI
without GitHub Actions.

## Roadmap

The roadmap is organized by user-visible capability, not by infrastructure layer.
Every completed slice must have a focused example README answering “How do I do X?”

### Portable CI program

- [x] Author typed actions with intrinsic dependencies and compose them into workflows.
- [x] Plan without executing and render the discovered DAG in a first-class check.
- [x] Run the same program directly on an existing local or GitHub workspace.
- [x] Make the repository entry point directly executable as
  `.cloudflare/workflows/ci.run.ts`.
- [x] Add stable agent-facing commands for `plan`, `run`, `list`, and targeted actions.
- [x] Document the one command agents should run instead of discovering package-specific
  lint, format, test, and build scripts themselves.
- [ ] Add a future `cf ci` façade over the same runtime rather than a second engine.

The executable local program is the canonical agent-first interface: an agent can
change code, run the repository's CI, read structured failures, and repeat without
knowing whether the project uses npm, pnpm, uv, Turbo, or several of them.

### GitHub-native adoption

- [x] Run the portable program inside an ordinary GitHub-hosted job.
- [x] Publish one GitHub check per action with logs and dependency-aware ordering.
- [x] Use protected GitHub Environments for production approval.
- [ ] Package invocation as a small reusable action/workflow for existing repositories.
- [ ] Support a self-hosted runner label such as `effect-ci` with an already-registered
  runner.
- [ ] Prototype a [RunsOn-style](https://runs-on.com/) ephemeral runner controller where labels are resource
  constraints and a Cloudflare-backed runner is registered per GitHub job.

The last item preserves every existing GitHub Action step; only `runs-on` changes. It
is the gentlest migration path, but it also means running the GitHub Actions runner
protocol and lifecycle. It should not be conflated with interpreting `ci.run.ts`
directly in a Cloudflare Workflow.

### Cloudflare-native execution

- [x] Bundle the portable program as a Cloudflare `WorkflowEntrypoint`.
- [x] Execute `checkout → install → build` in a Container with native durable steps.
- [x] Exercise the Workflow and Container together under `wrangler dev` in E2E.
- [x] Move Workflow/Container host mechanics into `@effect-ci-testbed/cloudflare` so
  examples contain only userland Worker, workflow, and action code.
- [x] Use the managed Debian Trixie image for ordinary Node.js CI without a Dockerfile.
- [x] Prepare additional tools with `exec()` and snapshot the managed Trixie workspace
  so later Containers can reuse the toolchain without a Dockerfile.
- [x] Persist an installed workspace as a native filesystem snapshot, replace the live
  Container, and restore the snapshot before building.
- [ ] Trigger runs from authenticated repository events without GitHub Actions.
- [ ] Publish the same check and log model back to the source provider.
- [ ] Prove retry, suspension, cancellation, and replay around external side effects.
- [ ] Restore one workspace snapshot into parallel lint, test, and build Containers.
- [ ] Publish portable build artifacts separately from workspace snapshots.

### Agent, healing, and deployment capabilities

- [x] Return structured plans and stable error identities that an agent can consume
  without scraping logs.
- [ ] Add typed tool diagnostics to structured action failures.
- [ ] Compose action-specific healing, verification, commit, suggestion, and approval.
- [ ] Distinguish safe automatic fixes from proposed changes requiring HITL approval.
- [ ] Add preview, staging, and production deployment examples with typed artifacts.
- [ ] Add notifications as composable observers rather than workflow control flow.

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
success, neutral-warning, failure, and skipped checks without adding GitHub concerns
to the workflow.
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
- On Cloudflare, the executor should preserve this workspace contract rather
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
| [`hitl-deploy`](./examples/hitl-deploy) | protected production deployment with human approval | ✅ | ✅ | ⬜ |
| [`cloudflare-runner`](./examples/cloudflare-runner) | checkpoint and restore an installed workspace in a managed Cloudflare Container | — | ✅ | ✅ |
| [`cloudflare-toolchain`](./examples/cloudflare-toolchain) | install a Python toolchain once, snapshot it, and build from the prepared workspace | — | ✅ | ✅ |
| `node-version` | custom Node version and architecture | ⬜ | ⬜ | ⬜ |
| `workers-app` | Worker lint, tests, build | ⬜ | ⬜ | ⬜ |
| `workers-preview` | PR preview target and cleanup | ⬜ | ⬜ | ⬜ |
| `turbo` | existing Turbo graph and cache | ⬜ | ⬜ | ⬜ |
| `vite-plus` | cooperative automatic cache metadata | ⬜ | ⬜ | ⬜ |
| `monorepo` | multiple apps and affected packages | ⬜ | ⬜ | ⬜ |
| `mirrored-source` | same repository pushed from GitHub or GitLab | ⬜ | ⬜ | ⬜ |
| `manual-reconcile` | compare latest source with deployed revision | ⬜ | ⬜ | ⬜ |
| `gradual-deploy` | version upload, percentages, health, rollback | ⬜ | ⬜ | ⬜ |

Heavy multi-deployment orchestration is deliberately a separate future feature. The first deployment examples should run the commands developers naturally run and capture structured tool output such as Wrangler's output file.

## First vertical slice

The executable entrypoint is deliberately inside `.cloudflare/workflows` rather than
adding another root-level config file. It default-exports the repository workflow and
re-exports action definitions as named CLI targets:

```ts
#!/usr/bin/env -S node --import tsx

import * as CLI from "@effect-ci-testbed/cli"
import * as actions from "../actions/index.ts"
import workflow from "./pull-request.ts"

export * from "../actions/index.ts"
export default workflow

if (CLI.isMain(import.meta.url)) {
  await CLI.runMain({ actions, workflow })
}
```

`@effect-ci-testbed/cli` owns the shell contract while `@effect-ci-testbed/ci` remains
provider-neutral. Effect 4 includes an `effect/unstable/cli` module; this first slice
keeps the public command surface in a separate package so adopting that parser as it
stabilizes does not alter workflow files. Agent detection follows Wrangler's precedent:
explicit `--format=text|json` wins, only a directly detected agent defaults to JSON,
and detection errors fall back to text.

Process exit codes are intentionally broad and portable: `0` success, `1` workflow or
action failure, `2` usage or configuration, `3` unavailable provider, and `4` rejected
or unavailable approval. Stable granular identities such as `CI_COMMAND_FAILED` and
`CI_REMOTE_UNAVAILABLE` live in JSON; values above 255 are not portable through shells.

[`examples/node-npm/.cloudflare/workflows/pull-request.ts`](./examples/node-npm/.cloudflare/workflows/pull-request.ts)
coordinates actions from
[`examples/node-npm/.cloudflare/actions/index.ts`](./examples/node-npm/.cloudflare/actions/index.ts):

```text
checkout → install → [lint (required) ∥ format (optional)] → test → build
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
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return {
    workspace: yield* npm.install({ frozenLockfile: true }),
  }
})

export const lint = CI.action<CI.Workspace>("lint", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  return yield* npm.run("lint")
})

export const format = CI.action<CI.Workspace>("format", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  return yield* npm.run("format")
})

export const test = CI.action<CI.Workspace>("test", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  return yield* npm.run("test")
})

export const build = CI.action<BuildArtifacts>("build", () => function* () {
  const installation = yield* install()
  const npm = yield* CI.PackageManager.JavaScript(installation.workspace)

  yield* npm.run("build")

  return { installation, paths: ["dist/index.js"] }
})
```

An action's construction generator resolves action-specific dependencies and returns
the durable implementation. The implementation yields prerequisite actions before doing
its own work, so invalid compositions are not expressible through the public action API:
`lint()` and `build()` always install. The `hitl-deploy` example applies the same rule
to deployment: `deploy()` yields `build()` to obtain its artifacts. The planner observes
those yielded actions directly and derives `needs`
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

  yield* CI.parallel([
    actions.lint(),
    CI.optional(actions.format()),
  ])
  yield* actions.test()

  return yield* actions.build()
})
```

This deliberately matches the canonical GitHub workflow's validation matrix. Lint and
format both finish because the matrix disables fail-fast; lint failure blocks the later
pipeline job, while format has `continue-on-error` and does not block it. The matrix
form also remains executable by `act`, which does not yet parse GitHub's newer native
parallel-step syntax. Parallelism and optionality belong in workflow policy, not the
reusable actions. Mandatory dependencies remain inside the actions. The focused
[`hitl-deploy`](./examples/hitl-deploy) example shows a release workflow requesting only
`deploy()` while still getting checkout, install, and build.

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

`CI.parallel` is the workflow-level shorthand for independent work that must all finish.
It uses Effect's failure-accumulating validation so one mandatory failure does not cancel
the other branches:

```ts
yield* CI.parallel([
  actions.lint(),
  CI.optional(actions.format()),
])
```

`CI.optional` is policy on this invocation, not a property of the `format` action. It
recovers only a failure produced by that action, records the output, and reports a
neutral GitHub check. It does not hide checkout/install failures: those remain failed
prerequisites. `CI.parallel` discards heterogeneous success values because the group is
a gate; action outputs remain available when actions are yielded directly. `Effect.orDie`
is intentionally not used because defects are inappropriate for expected CI failures.
The canonical GitHub workflow expresses the same policy with a non-fail-fast matrix and
`continue-on-error: true` on its format entry.

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

Deployment approval is now a first-class runtime capability. An action yields
`CI.Approval`, requests a decision, and does not begin the guarded side effect until the
request resolves:

```ts
export const deploy = CI.action<Deployment>("deploy", () => function* () {
  const artifacts = yield* build()
  const approval = yield* CI.Approval

  yield* approval.request({
    title: "Approve the production deployment?",
    summary: "Build passed. Approve to deploy.",
  })
  yield* artifacts.installation.workspace.exec("echo npx cf deploy")

  return { artifacts, target: "production" }
})
```

An approved request returns normally. A rejected request fails the action with a typed
`ApprovalError` whose decision is `"rejected"`; a missing or broken adapter fails with
decision `"unavailable"`. In either failure case, execution stops at the `yield*` and
the guarded deploy command is never invoked.

On GitHub Actions, production approval is owned by a protected GitHub Environment. The
deployment job declares `environment: production`, so GitHub pauses it before assigning
a runner or exposing environment secrets. Once a required reviewer approves the job,
the adapter supplies `EFFECT_CI_APPROVAL=approved`; `CI.Approval` then records the
already-resolved platform decision and the deployment action may continue. No app
webhook is involved in this GitHub-native path.

Rejecting the pending GitHub deployment fails that explicitly dispatched deployment
workflow. GitHub does not provide a seconds-long expiry for required-reviewer gates: a
job remains `Waiting` for a reviewer and eventually fails after GitHub's platform
timeout. Therefore the pull-request E2E suite does not start a protected deployment.
It uses deterministic approved and rejected handlers to verify both outcomes, while
the separately dispatched `Effect CI HITL Deploy` workflow exercises the real
`production` environment UI without becoming a required PR check.

The approval action remains part of the portable workflow because a future remote
runner cannot rely on GitHub Actions to suspend its execution. That runner will need a
different `ApprovalHandler`, potentially backed by GitHub App check actions, Cloudflare,
or Slack, without changing the workflow's action graph.

The [`hitl-deploy`](./examples/hitl-deploy) example keeps pull-request validation
separate from deployment. Its deploy workflow can be dispatched manually, rebuilds
through intrinsic dependencies, and runs the deliberately harmless
`echo npx cf deploy` command only in a GitHub job protected by `production`.

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
NODE_ENV=staging ./examples/node-npm/.cloudflare/workflows/ci.run.ts plan

# List and run one exported action with machine-readable output.
./examples/node-npm/.cloudflare/workflows/ci.run.ts list
./examples/node-npm/.cloudflare/workflows/ci.run.ts run lint --format=json

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
reports both modes. Its compatibility runner still selects planning through `DRY_RUN`;
the executable entrypoint uses the explicit `plan` command.

### Approval adapters

`EFFECT_CI_APPROVAL=approved` or `rejected` supplies a deterministic adapter. GitHub's
production deployment job sets `approved` only after its protected Environment gate has
passed. Local E2E uses the same adapter to verify both outcomes without requiring a
human. Remote execution will provide an asynchronous handler instead.

`CI.run(workflow, { mode })` is the interpreter boundary in the prototype. Both modes
run the same dependency-yielding Effect program with hydrated values and return the
same `{ value, plan }` contract. Planning suppresses workspace commands; execution
runs them:

```ts
const result = await CI.runPromise(workflow, {
  mode: process.env.DRY_RUN ? "plan" : "execute",
})
```

The plan contains topologically ordered nodes, direct `needs` and `after` edges, commands,
working directories, durable step options, and status. It is intended to feed the
eventual DAG visualizer and permission audit without introducing a separate workflow
definition or planning DSL.

`needs` means a successful result is required. `after` is an ordering-only edge: the
downstream action waits for completion but is not blocked by that action's warning.
`CI.parallel` records a shared stage and establishes the next workflow barrier. Thus the
example plan says test **needs** lint and runs **after** optional format, while intrinsic
action dependencies remain reusable and separate from workflow scheduling policy.

## Current prototype semantics

- `import * as CI` follows Effect's module style and keeps provider implementations out of the core package.
- `CI.action(id, construction, options?)` resolves service dependencies and returns a durable implementation; that implementation yields mandatory prerequisite actions and returns typed outputs.
- `CI.step(id, body, options?)` remains the lower-level fixed-step primitive.
- Ordinary Effect composition controls execution. The Node examples use `CI.parallel` for required lint plus optional format, then resume sequential fail-fast execution for test and build. `hitl-deploy` isolates deployment and approval semantics.
- `CI.optional(effect)` marks one invocation non-blocking. Its own failure is reported as a neutral warning; prerequisite failures still propagate.
- Repeatedly yielding the same step executes it once in the current Effect runtime. The
  Cloudflare adapter maps the same stable action ID to a native Workflow step so its
  remote operation is checkpointed across replay.
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
- Runtime configuration uses ordinary process environment for injected values:
  `NODE_ENV` defaults to `test` when `CI` is set and `development` otherwise.
  `.cloudflare/workflows/ci.run.ts` owns the local CLI contract; the older generic
  GitHub adapter continues accepting `DRY_RUN` as a compatibility input.
- Dependency edges follow yielded prerequisite actions. Build, lint, and test each yield the cached install action; deploy yields the cached build action and consumes its typed artifacts.
- JavaScript chooses branches, targets, modes, and preview names. There is no condition DSL.
- Ordinary Effect error composition attaches retry, deterministic repair, agent healing,
  notification, or approval behavior to an individual action instead of forcing one
  recovery policy over the whole workflow.
- Durable retry options will use the Cloudflare `WorkflowStepConfig` shape. Effect `Schedule` is not accepted as step configuration.
- The default executor is workspace-first, not job-container-first. Distributed steps and artifact transfer are explicit later capabilities.

## Runtime boundary

The prototype now has one portable Effect runtime and two command interpreters:

```text
CI program
  └─ CI.run
       ├─ mode plan: hydrate values and record commands
       ├─ mode execute: run commands on the local/GitHub host
       └─ Cloudflare adapter: map actions to Workflow steps and commands to ctx.container.exec
```

The runner is selected through `CI.Source` and `CI.CommandExecutor`; workflow and action
authors do not branch on their host. Verification remains end to end: type-check the
packages, dry-run the real example, execute it against its local fixture, bundle the
Worker, and run the same graph through a local Cloudflare Workflow and Container.

### Local Cloudflare verification

Direct execution remains the fast local development path because it exercises the
portable workflow without requiring a Cloudflare emulator. The `cloudflare-runner`
E2E also starts
[`wrangler dev`](https://developers.cloudflare.com/workflows/build/local-development/)
and uses `wrangler workflows trigger <name> --local` to verify the Cloudflare-specific
source, command, snapshot, and restore interpreters. It complements direct execution
rather than replacing it. Suspension and retry remain later acceptance slices.

Cloudflare's local Workflow environment is emulated, so remote execution remains the
final parity check for platform behavior. Local Explorer and Cloudflare's
[Workflow visualizer](https://developers.cloudflare.com/workflows/build/visualizer/)
should become useful diagnostics for this runner, especially when approval,
sleep, retry, and recovery steps are introduced.

Cloudflare mode should keep ordinary Effect composition. The Workflow step is the durable boundary; the workflow does not need an Alchemy-style outer construction function merely to discover dependencies.

`Workspace` distinguishes a local directory from a remote workspace ID and path.
`workspace.checkpoint(name)` now returns a typed `WorkspaceCheckpoint`; restoring it
uses the host's persistence implementation. Local and GitHub execution retain the same
directory, while the Cloudflare implementation creates an immutable native Container
filesystem snapshot. Workspace checkpoints preserve mutable execution state. They are
not portable artifacts: releases, downloads, and long-lived deployment outputs still
belong in a separate artifact store.

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
