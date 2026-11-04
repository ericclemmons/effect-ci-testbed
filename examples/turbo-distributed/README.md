# Distribute a native Turbo task graph

Build a shared TypeScript library, a storefront, and an inventory dashboard.
These are the same app sources, package scripts, lockfile, and Turbo configuration
as [the single-machine Turbo recipe](../turbo-ci). There are no sleeps, synthetic
CPU loops, or isolation-probe files in either project.

The difference is orchestration: the single-machine workflow runs the existing
`npm run ci` command once; this workflow asks Turbo for its native graph and turns
its tasks into dependency-linked CI actions. Neither workflow lists packages or
manually groups parallel actions.

[Workflow](./.cloudflare/ci/workflow.ts "source")

## Real work, existing configuration

Core compiles JavaScript and type declarations with TypeScript. Web and admin
each bundle a browser app with esbuild, copy their HTML entrypoint, and run a
TypeScript check. Both apps import core through its normal package exports.

[Shared catalog](./app/packages/core/src/index.ts "source")

[Storefront](./app/packages/web/src/main.ts "source")

[Inventory dashboard](./app/packages/admin/src/main.ts "source")

[App commands](./app/packages/web/package.json#json=scripts "source")

[Native task configuration](./app/turbo.json "source")

Both app builds and checks depend on `^build`. Turbo supplies five nodes:
core's build, then each app's build and check. The adapter can dispatch those four
ready app tasks independently, each from the same installed snapshot plus core's
declared outputs and native cache. They do not share mutable working directories.
The final workspace contains core's JavaScript/declarations and both apps'
`dist/app.js` and `dist/index.html`.

Existing tag rules still apply: `ci` includes entrypoints, `!ci` excludes them,
and required dependencies remain. Core builds despite its `!ci` tag; core's
unused check and the legacy package do not run. `turbo.tags(...labels)` selects
a union of positive labels using Turbo's resolved-tag query.

## Run it

From the repository root, after `pnpm install`:

```sh
cd examples/turbo-distributed
effect-ci run --format=json
```

The one-line `local` export selects the reusable file-snapshot runner. Snapshot
storage, command execution, cancellation, and cleanup live in the runner package,
not in example-specific infrastructure. It copies only the explicitly selected
`app` directory, installs with a frozen lockfile, and gives each action its own
working copy. The CLI disposes of those copies on success or failure.

[Local runner configuration](./.cloudflare/ci/workflow.ts#symbol=local "source")

[Reusable snapshot runner](../../packages/local-container/README.md)

This local mode runs trusted commands on one host, not in physical Containers or
a security sandbox. It demonstrates graph execution and output/cache transfer,
not the capacity or performance of distributed infrastructure. Every new CLI run
starts from clean source; warm caches require a workspace/cache carried between runs.

To inspect or run the identical workload with ordinary single-machine Turbo:

```sh
npm --prefix examples/turbo-distributed/app ci
npm --prefix examples/turbo-distributed/app run ci -- --plan
npm --prefix examples/turbo-distributed/app run ci
npm --prefix examples/turbo-distributed/app run ci
```

That path uses Turbo's own local parallel scheduling and cache. It is the useful
baseline, not an artificially serialized executor. Small apps may be faster on
one machine because graph discovery, snapshots, per-task Turbo invocations, and
output joins have a cost. This example makes no distributed-speedup claim.

## Native graph to runner

Baseline: landed `main` at `b39cd394`
([PR #424](https://github.com/ericclemmons/effect-ci-testbed/pull/424)).
The `+` calls are implemented but unlanded in
[PR #427](https://github.com/ericclemmons/effect-ci-testbed/pull/427).
Tag-to-task selection moves from the recipe bridge into the SDK adapter;
local snapshot plumbing belongs to the reusable runner package.

```diff
 CI.workflow(id, body)
   checkout() → PackageManager.JavaScript(workspace).install() → installed Workspace
-  manager.run("check") → recipe tag-selection bridge → one Turbo process/workspace
+  inline CI.action("Turbo CI", construction)()
+    Toolchain.Turbo(workspace): Effect<TurboToolchain>
+      tags(...labels): Effect<Workspace>
+        discovery action → native query/dry-run → immutable planned Workspace
+        native IDs and dependency edges → namespaced memoized CI actions
+        parallel terminal actions → resolve prerequisite actions once
+          task workspace = planned snapshot + prerequisite output/cache manifests
+          reject conflicting manifests before executing
           runner.executor.execute({ workspace, stepId, command, onOutput })
+            native hash/cache preflight → normal Turbo target → verify run summary
+          success → bounded result manifest → runner commits snapshot
+          required failure → preserve error; do not dispatch dependents
+        join terminal outputs/cache onto planned snapshot → return Workspace
+ CLI local configuration → makeSnapshotRunner({ root, paths }): RunConfiguration
+   per-action copies; command output → onOutput; abort → kill owned process group
+   finally → dispose(): stop processes, await exit, delete temporary copies
+ Cloudflare configuration → existing revision-aware runner
+   action-specific Container → snapshot restore/commit; release successful commit
```

Turbo owns task commands, hashes, environment filtering, and cache restoration.
The adapter never extracts commands or rewrites dependencies. Each invocation
uses an explicit run-local cache directory; no remote cache service is required.

[SDK adapter](../../packages/ci/src/turbo.ts "source")

[Native execution bridge](../../packages/ci/src/turbo-bridge.ts "source")

Ordinary `effect-ci plan` records discovery only. Source-bound native graph
expansion happens after checkout and installation during execution, not before.

## Remote execution

The worker uses the existing Cloudflare runner. Revision-bearing task actions
select separate Containers; ready tasks restore the same installed revision plus
their prerequisites' declared outputs/cache. `reuseWorkspace: false` releases
successfully committed Containers. Complete failure/read cleanup is not established.

[Worker](./src/worker.ts "source")

[Cloudflare configuration](./wrangler.jsonc "source")

An enrolled host can run this workflow through `--remote`. Deployment, host
enrollment, credentials, account selection, and paid execution remain separate.
This example has not established hosted execution, distributed speedup, or
host-signed receipts.

## Prototype limits

- Turbo 2.11.10 only, with at most 256 finite cacheable nodes and stable native
  hashes. Persistent, interactive, companion, scriptless, and deferred-hash tasks
  fail rather than receiving approximate behavior.
- Only regular declared output files, native logs, and native cache bytes cross
  branches. Native summaries supply expanded paths; the adapter does not match
  globs itself. Symlinks, conflicting producers, and serialized joins over 48 KiB
  fail. Empty directories and output deletions are not transported.
- Before task admission, hashes must match the original graph and prerequisites
  must report local cache hits. The native run summary must confirm those hits.
  A corrupt archive discovered after preflight can still make Turbo rerun a
  prerequisite; this is not an exactly-once executor. Use deterministic builds
  and checks, not deployments or other side effects.
- Source-bound preflight planning, large artifact transport, robust hosted failure
  cleanup, and host signing remain future work.

Installed Turbo docs define the native contract. Existing `snapshot-fanout`,
`turborepo-cache`, and the local runner package supply implementation prior art;
there is no repository SOP for distributed Turbo execution.

The earlier timeout-based fixture and its timing results are superseded by these
real compiler/bundler apps. Local validation is not deployed execution.

## Recorded local verification

On October 29, 2026, ordinary Turbo and the graph adapter ran from the same
installed snapshot. All six output files were byte-identical, and all five native
task hashes matched between execution models. Core executed once in the cold
graph run; the four dependent invocations restored its native cache.

Deleting every output directory and rerunning from each completed workspace
restored all outputs with native cache hits. Changing the shared catalog then
invalidated core and all four app tasks; both bundles contained the changed
product. The two execution models again produced identical files.

Both documented workflows also completed through the real CLI. Injecting a core
build failure dispatched none of the four dependent app tasks. The 44 existing
SDK tests, 15 CLI/ergonomics tests, all example type/plan checks, documentation
build, and Worker/Container-image dry run passed. No tests were added or changed;
both Turbo examples remain visible in the homepage feature matrix.

This small local workload was slower through the graph adapter, not faster.
The verification establishes real builds, dependency order, cache restoration,
invalidation, and output parity—not a performance advantage over native Turbo.
