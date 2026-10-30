# Distribute a native Turbo task graph

One action selects existing Turbo tags. The adapter turns Turbo's dependency graph
into ordinary CI actions; users do not write per-package actions or parallel groups.

[Workflow](./.cloudflare/ci/workflow.ts "source")

`PackageManager.JavaScript(workspace).install()` now freezes the lockfile by
default, locally and in CI. Use `{ frozenLockfile: false }` only when intentionally
updating dependencies. `Toolchain` already contains Node and Mise; Turbo joins
that namespace rather than introducing another task API.

`turbo.tags("ci")` selects tasks carrying `ci` without `!ci`, using Turbo's native
resolved-tag query. Additional labels form a union; negated requested labels
exclude entrypoints. Required dependencies remain, including core's `!ci` build.
Legacy and core's unused check must never run.

[Native task configuration](./app/turbo.json "source")

## Run locally

```sh
effect-ci run --workflow examples/turbo-distributed/.cloudflare/ci/workflow.ts --format=json
```

The recipe's local adapter installs into a disposable copy and makes immutable
filesystem snapshots. Every action gets its own working copy. It runs trusted
fixture commands on the host, not in a security sandbox or physical Container.
The CLI removes the temporary copies after success or failure.

[Local snapshot runner](./.cloudflare/ci/local.ts "source")

The shared core builds once. Web and admin restore the same installed snapshot
plus core's declared outputs and native cache concurrently. Both deliberately write `app/branch.txt`, pause, then
check their own value. Shared mutable workspaces would fail this check. The final
workspace contains all three build outputs but no branch's undeclared file.
Build timestamps are fixture instrumentation for overlap, not reusable evidence.

[Build and isolation proof](./app/scripts/build.mjs "source")

## Native graph to runner

Baseline: landed `main` at `b39cd394` ([PR #424](https://github.com/ericclemmons/effect-ci-testbed/pull/424)).
The `+` calls are this unlanded prototype; unchanged calls remain unprefixed.
Task selection moves from that recipe's script into the SDK Turbo adapter.

```diff
 CI.workflow(id, body)
   checkout() → install() → immutable installed Workspace
-  manager.run("check") → recipe bridge → one Turbo process
+  inline CI.action("Turbo CI", construction)()
+    Toolchain.Turbo(workspace): Effect<TurboToolchain>
+      tags(...labels): Effect<Workspace>
+        discovery action → native query/dry-run → immutable planned Workspace
+        create namespaced action factories from native task IDs and edges
+        parallel terminal actions → memoized prerequisite actions
+          each task → planned snapshot plus prerequisite output/cache manifests
+          join → conflict-check parent file/cache manifests
           runner.executor.execute(request)
+            native hash/cache preflight → normal Turbo target → run summary
+          success → publish bounded result manifest; commit Workspace
+          required failure → block dependents; preserve error
+        join terminal outputs onto planned snapshot → return Workspace
+   local adapter finally → delete owned temporary workspaces
```

Turbo still owns hashes, strict environment filtering, cache restoration, and task
execution. The adapter never executes an extracted task command or rewrites its
dependencies. Each native invocation uses an explicit run-local cache directory;
it does not access a linked worktree's shared cache or require a remote cache service.

[SDK adapter](../../packages/ci/src/turbo.ts "source")

[Native execution bridge](../../packages/ci/src/turbo-bridge.ts "source")

The execution report contains five native task actions. Ordinary `effect-ci plan`
records the discovery action only: it does not run Turbo or claim to know the
source-bound task graph before checkout and installation. Expansion happens during
execution. Source-bound preflight expansion remains future work.

## Cloudflare path

The worker uses the existing runner. Revision-bearing task actions select separate
Containers; web and admin both restore the installed revision plus core's outputs
and native cache. Undeclared parent mutations are not inherited. It releases each
successfully committed Container with `reuseWorkspace: false`. This is not a claim
of complete cleanup after failed commands or snapshot reads.

[Worker](./src/worker.ts "source")

[Cloudflare configuration](./wrangler.jsonc "source")

An enrolled host can run the same workflow through `--remote`. Deployment, host
enrollment, credentials, account selection, and paid execution are separate steps;
this recipe does not provision them. Physical linear-Container reuse is not added.
No hosted execution, distributed speedup, or signed receipts are established here.

## Supported prototype boundary

- Turbo 2.11.10 only; finite cacheable tasks with stable native hashes, at most
  256 task nodes. Persistent, interactive, companion, scriptless, and deferred-hash
  tasks are rejected rather than approximated.
- Only regular output files, native task logs, and opaque native cache bytes cross
  branches. Native run summaries supply expanded paths; the adapter does not
  implement Turbo glob matching. Symlinks, conflicting producers, and joins over
  48 KiB of serialized manifest data fail. Empty directories and output deletions
  are not transported; use disjoint, file-producing tasks on a clean installed base.
- Before admitting a task, its native hash must match the original graph and every
  prerequisite must report a local cache hit. After execution, the native summary
  must confirm those hits. Missing or changed inputs fail the run.
- This is not a native cache-only executor. Turbo may rerun a prerequisite if an
  archive becomes unreadable after preflight; the summary detects that only after
  execution. Use deterministic cacheable checks/builds, never deployments or other
  side effects. Exactly-once execution needs a stronger native execution contract.
- Result manifests are project-controlled transport, not host-signed attestations.
  General artifact overlays, large-object transport, source-bound planning, robust
  failure cleanup, and signing remain separate work.

The installed Turbo documentation (`reference/query.mdx`, `reference/run.mdx`, and
`crafting-your-repository/caching.mdx`) supplies the native contract. Existing
`snapshot-fanout` and `turborepo-cache` recipes supply runner/configuration prior art;
there is no repository SOP for distributed Turbo execution.

## Recorded verification

On October 29, 2026, the local snapshot runner executed five native task actions.
Core executed once; both app invocations reported a native prerequisite cache hit,
with hashes matching the original full graph. Web and admin overlapped for 721 ms.
All three build outputs survived the join; the undeclared branch file did not.
A warm run preserved the cached output. Injecting a required core failure dispatched
neither dependent app build.

The 44 existing SDK tests and 57 CLI/ergonomics tests passed. All example TypeScript
checks, existing example-plan checks, the 99-page documentation build, and Wrangler's
worker/Container-image dry run passed. No tests were added or changed. These are
local proofs, not deployed Cloudflare execution or signed evidence.
