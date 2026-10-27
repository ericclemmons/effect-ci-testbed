# Derive deployment order from a task graph

Import the existing [backend and frontend fixture](../ordered-deploy) from the
installed Turborepo task graph. Build dependencies do not imply that an API is
already deployed: the frontend deployment also needs the backend deployment.

[Task dependencies](./turbo.json "source")

## Inspect the graph

From the repository root after `pnpm install --frozen-lockfile`:

```sh
node examples/task-graph-deploy/plan.ts
```

This invokes the pinned Turbo 2.11.10 with `--dry=json`, then emits only stable
task IDs, typed prerequisite edges and generator version. Hashes, timestamps,
machine paths and cache state are not part of the normalized graph. The
recipe-specific configuration selects only the two existing apps; it does not
change how other recipes run. Its explicit cache directory stays in the current
worktree instead of Turbo's default shared main-worktree cache.

[Graph derivation](./plan.ts#symbol=deriveGraph "source")

Both builds precede backend deployment because #151's preparation pins both
output digests before any publication. This is a build prerequisite, not a claim
that frontend deployment must happen first.

Deployment tasks deliberately have no package scripts. They are Turbo transit
nodes with real build prerequisites, not shell commands that can deploy a target.
The graph importer requires a runnable script for each build node. It rejects
unknown apps/task kinds, duplicate IDs, missing dependencies and cycles before
calling any executor. It does not infer deployment edges from package imports.

[Importer](./graph.ts#symbol=importTurboGraph "source")

## Execute with the deployment owner's callbacks

`executeGraph(graph, handlers)` validates the complete graph and all handler
bindings before running anything. It awaits each callback in deterministic
dependency order, calls each task once, and stops at the first rejection. A
backend deployment or health-check rejection prevents frontend deployment.
Independent work is serialized in this small example; this is not a parallel
scheduler or a durable, exactly-once deployment engine.

[Executor](./graph.ts#symbol=executeGraph "source")

Handlers are keyed by the task IDs printed by the plan. The deployment owner
supplies both build callbacks and both deploy callbacks. Each deploy callback
must resolve only after actual deployment **and served-health verification**.
The current unlanded #151 contract exposes
`deployTarget(host, workspace, prepared, app, signal, prerequisite?)`; its host
owns `prepare(workspace)`, publication, inspection, recording and health reads.
An adapter must prepare once after both builds, retain the verified backend
receipt for the frontend callback, and pass the caller's cancellation signal.
That adapter is not implemented here because #151's contract is not landed.

Deployment targets, credentials, health checks, idempotent receipts and recovery
remain owned by [issue #151](https://github.com/ericclemmons/effect-ci-testbed/issues/151).
This recipe never executes a command from imported JSON or obtains credentials.
Already completed callbacks are not rolled back by this executor. The owner must
handle cleanup and retry reconciliation before allowing another run.

## Compare with the explicit-order recipe

Baseline: main commit `20f29103911800606929de4f9afa095667606e48`.
The existing explicit recipe is unchanged and uses `cf deploy --dry-run`.
The graph importer/executor below are implemented by this PR; the hosted callback
adapter is future integration owned by #151, not a current API in that recipe.

```diff
 explicit deploy()
   build() -> backend build; frontend build
-  deployBackend() -> cf deploy --dry-run
-  deployFrontend() -> cf deploy --dry-run
+ deriveGraph() -> installed Turbo --dry=json -> importTurboGraph(input, version)
+ executeGraph(graph, handlers) -> validate all nodes/edges and bindings
+   backend#build -> owner build callback
+   frontend#build -> owner build callback
+   backend#deploy -> owner prepare(workspace); deployTarget(..., "backend", signal)
+     publish -> inspect immutable version -> served health -> verified receipt
+   frontend#deploy -> owner deployment + served-health callback
+     deployTarget(..., "frontend", signal, backendReceipt)
+     recheck backend -> publish -> frontend/API health -> verified receipt
+   rejection -> stop; owner retains receipts, cleanup and recovery
```

No behavior moves out of the existing recipe in this PR. Only the selection of
execution order moves from handwritten calls to task-tool edges when an owner
uses this executor. Frontend build has no deployment dependency; frontend deploy
does. Both output digests remain available before preparation/publication. The
future adapter reuses #151's receipt and cleanup behavior rather than moving it.

## Evidence boundary

This is an import and execution-contract example, not hosted deployment proof.
The plan's deployment nodes are metadata; printing them does not deploy either
app or prove either endpoint healthy. Local callback checks do not satisfy the
target-environment acceptance criteria of
[issue #153](https://github.com/ericclemmons/effect-ci-testbed/issues/153).
Keep that issue open until #151's approved target adapter can run both success
and backend-failure cases with real deployment/served-health receipts.

[Local verification](./verification.md)

## Guidance and prior art

Read the installed package's `docs/README.md`, then its package/task graph,
task configuration, `run --dry`, `TURBO_ROOT_TURBO_JSON` and `cacheDir` references.
These shipped with Turbo 2.11.10; they describe the installed behavior, not a
promise about older versions. The existing [Turbo cache recipe](../turborepo-cache)
uses 2.11.6 and remains unchanged.

The collocated-README convention comes from
[the docs authoring guide](../../apps/docs/README.md), last changed in main on
October 24, 2026. Existing code shape comes from the ordered-deploy and
Turbo-cache recipes. No repository-specific graph-import process document or
landed graph-import implementation was found; the importer is a new, narrow
adapter based on the installed tool contract.
