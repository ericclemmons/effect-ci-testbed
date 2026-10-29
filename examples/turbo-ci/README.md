# Run existing Turbo CI tasks

Keep the repository's Turbo task graph. Select tasks tagged `ci`, retain their
prerequisites, and let Turbo schedule and cache them. No package list,
`CI.parallel`, new workspace API, or copied dependency graph is needed.

**Prototype scope:** this recipe implements CI task selection and native Turbo
execution, not distributed Containers or automatic Turbo detection throughout
Effect CI. The selection bridge lives in this recipe; projects do not get this
behavior merely by installing Effect CI today.

## Existing project configuration

[Root tasks](./app/turbo.json#json=tasks "source")

The fixture has two apps, `web` and `admin`, sharing `core`. Both apps build and
check. Their builds require `core#build`. Turbo owns dependency order, hashes,
environment filtering, and cache restoration. This recipe adds no concurrency
cap; native Turbo scheduling still runs in one workspace, not separate Containers.

- `core#build` has `!ci`: it is not an entrypoint but still runs as a dependency.
- `core#check` has `!ci` and is not needed, so it does not run.
- `admin#build` appends to inherited tags with `$TURBO_EXTENDS$`.
- `legacy#build` has both `ci` and `!ci`; exclusion wins for entrypoint selection.
- `legacy#check` clears inherited tags. Neither legacy command should run.

[Core overrides](./app/packages/core/turbo.json "source")

[Admin inheritance](./app/packages/admin/turbo.json "source")

[Legacy exclusions](./app/packages/legacy/turbo.json "source")

## Run it

From the repository root:

```sh
npm --prefix examples/turbo-ci/app ci
npm --prefix examples/turbo-ci/app run ci -- --plan
npm --prefix examples/turbo-ci/app run ci
npm --prefix examples/turbo-ci/app run ci
```

The plan is Turbo's native dry-run JSON, not an Effect CI package-task plan.
Expect four selected entrypoints (`web` and `admin`, each with `build` and
`check`) and five executable tasks after Turbo adds `core#build` once. The
second execution should report five cache hits. Change `core/message.txt` to
invalidate the shared build and both dependent app builds.

The apps read `core/dist/message.json`; a missing prerequisite output fails the
build. Shared build/check scripts are included in task inputs, so changing their
implementation also invalidates the appropriate cache entries.

To run the same entrypoint through the existing Effect CI package-manager API,
after the repository's usual `pnpm install`:

```sh
pnpm exec effect-ci --workflow examples/turbo-ci/.cloudflare/ci/workflow.ts plan
pnpm exec effect-ci --workflow examples/turbo-ci/.cloudflare/ci/workflow.ts run
```

[Effect CI workflow](./.cloudflare/ci/workflow.ts "source")

Effect CI sees checkout, install, and one `Turbo CI` action. Turbo's five tasks
remain inside that action. The first command does not discover the nested Turbo
graph; use the native `--plan` command above to inspect it.

## Reuse the owning implementation

[Recipe selection bridge](./app/scripts/ci.mjs "source")

The bridge asks Turbo 2.11.10 for resolved package/task tags through `turbo query`.
Turbo resolves package configuration and tag inheritance. A native query
predicate selects `ci` without `!ci`; only those task IDs are passed to
`turbo run`. Turbo adds required dependencies, including excluded entrypoints
that another task needs. The bridge does not parse `turbo.json`, reproduce task
hashing, or run extracted shell commands itself. An empty selection or failed
query fails clearly instead of running everything.

This follows the task-selection rules in the
[Vercel CI configuration reference](https://vercel.com/docs/ci/configuration)
(updated October 28, 2026). Concrete CLI/query behavior follows the installed
Turbo 2.11.10 docs: `docs/README.md`, `reference/query.mdx`, `reference/run.mdx`,
`reference/configuration.mdx`, and `crafting-your-repository/constructing-ci.mdx`.
The existing `turborepo-cache` recipe supplies npm-workspace prior art;
`apps/docs/README.md` supplies the source-link authoring convention. This example
updates independently to the npm `latest` release checked October 29, 2026.

This is not full Vercel CI emulation. Vercel deployment dependencies, OIDC,
resource tags, services, affected-only selection, and hosted execution are not
implemented. The example uses local Turbo cache only; it needs no token or cloud
deployment. Neither cache entries nor task results receive Effect CI signatures.

## Distributed execution: next boundary

The intended user surface stays `effect-ci run --remote`, or the existing
`PackageManager.JavaScript(workspace).run(script)` in an authored workflow.
There is no proposed `workspace.tasks()` method or user-authored parallel group.
This routing is not implemented: the current example still runs one Turbo process.

Assume Container fan-out and compute are freely available. The remaining design
is a graph-to-workspace mapping. The runtime recognizes a supported Turbo run,
asks Turbo for its native graph, and represents its tasks as execution units.
Every node whose required predecessors succeeded can start immediately.

- A linear successor can reuse an idle Container if its filesystem is exactly
  the required predecessor result and there is no competing mutable owner.
- Sibling consumers get independent Containers restored from the same immutable
  parent snapshot. Their writes never affect each other or the saved parent.
- A join needs the outputs of all required parents. A single parent's snapshot
  is insufficient. Restore declared outputs with provenance and reject conflicting
  writes; never merge whole sibling filesystems blindly.
- Returning from `manager.run` still needs a coherent `Workspace` for later
  sequential actions. Successful branch outputs must be assembled before that
  return, rather than returning an arbitrary sibling's workspace.

For this fixture, `core#build` produces snapshot S1 containing the installed
workspace, its output, and native Turbo cache. `web#build` and `admin#build` can
both consume S1 concurrently in separate Containers. Physical Container identity
is an optimization; the task's input snapshot and output provenance are the contract.

Baseline: landed `main` at `09f8d50`. Unprefixed calls remain; `+` is implemented
in this recipe. The second block is future architecture, not implemented APIs.

```diff
 Effect CI workflow → checkout() → install()
   PackageManager.JavaScript(workspace)
+  manager.run("check") → recipe bridge
+    turbo query → resolved CI entrypoint IDs
+    turbo run(entrypoints) → native dependency scheduling and caching
       one local/host workspace executes the selected task graph
```

```diff
 Full proposed remote path, relative to the landed baseline above:
   PackageManager.JavaScript(workspace).run(script): Effect<Workspace>
-    workspace.exec(package-manager command) → one opaque Turbo process
+    supported Turbo invocation → native query/dry-run graph
+      executeTurboPlan(plan, initialWorkspace): Effect<Workspace>
+        each dependency-ready task → workspaceFor(task, inputSnapshots)
+          exclusive linear continuation → reuse exact predecessor workspace
+          sibling branch → new Container restored from shared parent snapshot
+          join → assemble required outputs, reject conflicts
           runner.executor.execute(request) → native execution/cache semantics
+          on success → commit snapshot/output references; unblock successors
+          on required failure → block dependents; preserve the original error
+        join successful outputs → return coherent Workspace to caller
+        finally → stop run-owned Containers
```

`executeTurboPlan` and `workspaceFor` are architecture notation, not new SDK APIs.
The existing Cloudflare runner instead selects a Container using the action ID
when a workspace has a revision; it does not infer native Turbo task identities
inside a process. It also reuses an already materialized revision within that
Container. A task adapter must expose those boundaries before graph-driven
workspace selection can happen. No change to the user's package scripts is needed
for supported invocations; opaque shell wrappers must retain their existing behavior.

## Native execution boundary checked on the new release

Turbo 2.11.10 still exposes resolved task IDs, dependency edges, hashes, commands,
and output metadata through its documented query/dry-run interfaces. Its bundled
run/query docs and CLI help do not document a pluggable remote executor or a
single-node execution flag that preserves the full graph's hash.

The same fixture produced these hashes in native dry runs on October 29, 2026:

| Invocation | `web#build` hash |
| --- | --- |
| Both app builds, with dependency closure | `60ee5e9415a64460` |
| Web build alone, with dependency closure | `60ee5e9415a64460` |
| Web build with `--only` | `f8e9df15287b1694` |

These are observed fixture identities, not constants an adapter should hardcode.
The update does not remove the `--only` cache-identity difference. A first
cacheable-task path can retain the native dependency closure: restore S1 and invoke
each app's normal Turbo target. Core then restores from its native cache while the
app executes with its ordinary hash. That is not a general single-node executor:
uncacheable dependencies or a cache miss may rerun prerequisites. Such cases need
an explicit supported contract, not an exactly-once claim.

The graph is sufficient to identify independence; task execution and filesystem
results are the missing integration. Host signing is a separate continuation
after eligible execution, never a key exposed to the project Container.

```text
core result S1
  ├─ web Container   ← S1 → web output
  └─ admin Container ← S1 → admin output
```

That adapter still needs a proven native single-task execution/cache contract,
output transport, companion-task handling, cancellation/cleanup,
and trust enrollment. It must not silently rerun prerequisites in every Container, merge
sibling filesystems blindly, or replace Turbo's environment/cache rules with a
home-grown approximation. This example does not implement that adapter, import
the nested plan into Effect CI, or prove distributed speedup. Existing isolated
runner behavior is prior art, not proof of Turbo's distributed execution.

## Recorded local verification

On October 29, 2026, a disposable copy outside the repository selected four
entrypoints and five tasks, with one shared build and no legacy tasks. All five
tasks succeeded. After removing the three generated output directories, the
next execution restored all three with five cache hits. Changing the shared
source rebuilt core and both apps while retaining the two app-check cache hits;
both app outputs contained the changed value.

The initial verification used Turbo 2.11.6. After updating to 2.11.10, native
graph/hash comparisons were repeated; the `--only` distinction remains as shown
above. A cold run completed all five tasks, and the next run reported five cache
hits. The Effect CI wrapper's plan and execution, the recipe's TypeScript check,
and the existing documentation build also passed. No tests were added or changed.
These observations establish local selection, ordering, and cache behavior, not
hosted execution, distributed overlap, resource isolation, or signatures.
