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
environment filtering, and cache restoration. Native concurrency is capped at
two tasks in this recipe; that is not two Containers.

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

The bridge asks Turbo 2.11.6 for resolved package/task tags through `turbo query`.
Turbo resolves package configuration and tag inheritance. A native query
predicate selects `ci` without `!ci`; only those task IDs are passed to
`turbo run`. Turbo adds required dependencies, including excluded entrypoints
that another task needs. The bridge does not parse `turbo.json`, reproduce task
hashing, or run extracted shell commands itself. An empty selection or failed
query fails clearly instead of running everything.

This follows the task-selection rules in the
[Vercel CI configuration reference](https://vercel.com/docs/ci/configuration)
(updated October 28, 2026). Concrete CLI/query behavior follows the installed
Turbo 2.11.6 docs: `docs/README.md`, `reference/query.mdx`, `reference/run.mdx`,
`reference/configuration.mdx`, and `crafting-your-repository/constructing-ci.mdx`.
The existing `turborepo-cache` recipe supplies the pinned version and npm-workspace
prior art; `apps/docs/README.md` supplies the source-link authoring convention.

This is not full Vercel CI emulation. Vercel deployment dependencies, OIDC,
resource tags, services, affected-only selection, and hosted execution are not
implemented. The example uses local Turbo cache only; it needs no token or cloud
deployment. Neither cache entries nor task results receive Effect CI signatures.

## Distributed execution: next boundary

Yes, the native plan is useful input to distributed compute. Independent ready
tasks could start in separate Containers from one immutable installed snapshot.
Dependent tasks additionally need their prerequisite outputs. Snapshot reuse
removes a requirement to keep one mutable workspace alive; it does not transport
new dependency outputs automatically or make startup free.

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
 Future distributed path, relative to this recipe:
   recipe bridge → native task selection and planning
-  turbo run(entrypoints) executes the whole graph in one workspace
+  distributed adapter(plan, snapshot, budget) owns task admission
+    ready task → isolated Container → restore snapshot + prerequisite outputs
+    native task execution/cache boundary → result and output references
+    required failure blocks dependents; eligible results get host-signed receipts
+    finally → stop allocated compute and release capacity
```

That adapter still needs a proven native single-task execution/cache contract,
output transport, resource and companion-task handling, cancellation/cleanup,
and trust enrollment. It must not rerun prerequisites in every Container, merge
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

The Effect CI wrapper's plan and execution, the recipe's TypeScript check, and
the existing documentation build also passed. No tests were added or changed.
These observations establish local selection, ordering, and cache behavior, not
hosted execution, distributed overlap, resource isolation, or signatures.
