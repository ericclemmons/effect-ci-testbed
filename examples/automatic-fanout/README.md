# Review automatic dependency-ready scheduling

Prepare once, run two independent checks in isolated workspaces, then aggregate
their typed reports. The proposed author declares true dependencies, not a
`CI.parallel` wrapper. A two-action budget permits overlap; a one-action budget
serializes execution without changing the graph.

**Status: design review for [#171](https://github.com/ericclemmons/effect-ci-testbed/issues/171),
not an automatic scheduler.** This change adds a runnable **explicit baseline**
and a proposed contract. It does not change execution semantics, implement the
proposed APIs, or deprecate `CI.parallel`.

## Small example and readable plan

[Proposed declarations, not a loadable workflow](./proposal.json "source")

The dependency closure of `aggregate` is:

```text
checkout → prepare
prepare ──┬── left ───┐
          └── right ──┼── aggregate
prepare ─────────────┘

budget: 2 active action bodies, 2 isolated-workspace slots
checkout: ready → running → complete
prepare: ready → running → complete
left, right: waiting for prepare → ready → admitted independently
aggregate: waiting for prepare + left + right → ready → running
```

This is the proposed scheduling view, not current CLI status output. The two
checks need not start simultaneously. List position is not a dependency.

The runnable baseline uses the existing orchestration boundary:

[Explicit workflow](./.cloudflare/ci/workflow.ts "source")

[Actions and typed report values](./.cloudflare/ci/actions.ts "source")

After installing repository dependencies, run from the root:

```sh
cf-ci --workflow examples/automatic-fanout/.cloudflare/ci/workflow.ts plan --format=text
cf-ci --workflow examples/automatic-fanout/.cloudflare/ci/workflow.ts run --format=text
cf-ci --workflow examples/automatic-fanout/.cloudflare/ci/workflow.ts run left right --format=text
```

The default workflow prints one `prepared` record and an `aggregated` record
containing both intervals, their overlap, distinct workspace paths, and the
shared preparation token. The aggregate rejects missing, non-overlapping, or
non-isolated results. The multi-target command uses the CLI's **existing implicit
fanout**; it selects only the checks, so it does not run the aggregate. Selecting
`aggregate` alone would not express concurrency in today's pull-based runtime;
it is intentionally not exported as a CLI target here.

[Preparation](./app/prepare.mjs "source")

[Isolated check](./app/check.mjs "source")

[Aggregate](./app/aggregate.mjs "source")

These are trusted fixture commands, not untrusted workloads. They use the
existing [file-copy adapter](../snapshot-fanout/.cloudflare/ci/local.ts), which
copies only this recipe's `app/` into temporary directories and removes those
directories on disposal. No hosted resources or deployments are needed.

## Verified baseline and prior art

Baseline: `main` at `20f29103911800606929de4f9afa095667606e48`, inspected
October 26, 2026. This branch's fixture and design are unlanded additions.

- [CLI target selection](../../packages/cli/src/index.ts) validates all names
  before execution, wraps multiple targets in `CI.parallel`, and reuses shared
  prerequisites. Automatic fanout is not wholly absent.
- [Core runtime](../../packages/ci/src/index.ts) runs `CI.parallel` with
  `Effect.validate(..., { concurrency: "unbounded", discard: true })`. It collects
  independent failures, deduplicates shared errors, and memoizes actions by ID
  in a run runtime. It is not a resource-budgeted ready-node scheduler.
- The same runtime records workflow barriers in `addDependency`/`addParallel`.
  Action construction resolves prerequisites before the policy-bearing leaf.
  An observed graph does not prove arbitrary Effect instructions are reorderable.
- [Snapshot fanout](../snapshot-fanout) supplies filesystem isolation;
  [test splitting](../test-splitting/.cloudflare/ci/actions.ts) supplies typed
  reports consumed by an aggregate. Both use explicit orchestration.
- [Documentation guidance](../../apps/docs/README.md), landed October 24, 2026
  by Eric Clemmons, requires collocated READMEs and source-linked examples.
  [Project guidance](../../AGENTS.md) requires a small recoverable proof and
  explicit evidence limits. These guide this change's placement and validation.

No current approved automatic-scheduler process or migration contract was found
in the inspected project guidance and source. Issue #171 explicitly requires
human design review first; prior art supplies code shape, not that approval.
No Turborepo configuration, commands, graph import, or comparison changes here.

## Proposed authoring and migration contract

All names in the proposed half of the call diff below are **future APIs**.

| Surface | Proposed rule |
| --- | --- |
| Target | `CI.target(id, { needs, resources, exclusive?, run })` declares named typed prerequisite handles. `run` receives resolved values. The JSON uses names for review; the proposed TypeScript API uses handles to infer input types. No implicit prerequisite discovery by executing its body. |
| Graph | `CI.graph(id, { targets, budget })` selects roots and their dependency closure. Compilation validates cycles, duplicate definitions, positive integer limits, requests larger than limits, and runner support before any body or workspace allocation. |
| Dependencies | `needs` means required successful values. Each output retains its producer's source/workspace provenance; scheduling does not merge mutable files. Distinct parameterized work must keep distinct existing action definitions; this proposal does not redesign identity. |
| Budget | A run-scoped upper bound on active bodies plus named capability quantities. Hosts may lower limits, never silently raise them. This is not a fleet/account quota or a CPU/memory measurement. |
| Capability | Admission requires explicit adapter support for requested isolation and quantities. Missing support fails preflight; it must not silently fall back to a shared directory. |
| Exclusive resource | A named lock excludes overlapping bodies in this run. It does not order contenders. To preserve write/deploy order, add a true prerequisite edge; use an explicit serial chain when that is the intent. |
| Group | `GraphRun` observes and cancels one selected run's closure. Membership creates no edges, output dependencies, shared locks, or simultaneous-start promise. |

Only explicit dependency declarations authorize automatic scheduling. Keep
`CI.workflow`, `CI.action`, `CI.step`, CLI multi-target selection and `CI.parallel`
unchanged. Do not reinterpret existing generator yield order, action-construction
effects, or a graph produced by `plan` as this new authoring contract.

Migration is manual and opt-in: split prerequisites from leaf work, declare
typed `needs`, declare resource/isolation requirements, and copy every real
ordering constraint into dependencies. Hidden writes, approvals and deployment
effects must retain their order. The example migrates to the proposed graph
only after review; it does not route the JSON through the existing CLI today.

The first migration candidate is the all-required, unconditional example plus
its explicit checkout prerequisite. Existing optional/conditional/retry/rollback workflows stay on their
current executor until parity is demonstrated. The final API must preserve their
existing contracts, not accept them and silently change their meaning.
`CI.parallel` remains supported; removal needs separate compatibility evidence.

## Full call diff

This compares the landed baseline above with the full proposed end state, not
just this branch. Unprefixed calls remain. `-` calls leave **only the opt-in graph
path**; legacy workflows keep them. The declarations are architecture notation,
not executable imports or implemented TypeScript signatures.

```diff
  CLI.main(program: Program, args?, workflowPath?): Promise<ExitCode>
    selectedWorkflow(program, targets): CI.Workflow<unknown>
      CI.workflow(id, () => CI.parallel(selectedActions))  [legacy multi-target]
  CI.workflow<A>(id, body): Workflow<A>                    [legacy path stays]
  CI.action<A, Args>(id, construction, options?): (...args) => Effect<A>
  CI.step<A>(id, body, options?): Effect<A>

- Recipe: CI.workflow(id, function* () { yield* CI.parallel([left(), right()]); yield* aggregate() })
-   CI.parallel(effects) → Runtime.addParallel(parent, steps)
-     Effect.validate(effects, effect => effect, { concurrency: "unbounded", discard: true })
-   aggregate(): Effect<Workspace> → runStep(definition)
-     Runtime.addDependency(parent, id) → Cache.get(runtime.cache, id)
-     definition.prepare resolves dependencies → policy-bearing leaf

+ CI.target<A, Needs>(id, { needs: Needs, resources, exclusive?, run: Outputs<Needs> => Effect<A> }): Target<A>
+ CI.graph(id, { targets: readonly Target[], budget }): Graph
+ Graph.start(graph, adapter, { onEvent?: RuntimeEventHandler }): Effect<GraphRun, Error, Scope>
+   compile(graph, adapter.capabilities): Effect<ValidatedGraph>
+   fork scoped Scheduler.run(ValidatedGraph): Effect<RunResult> [owns ready queue]
+     resolve needs through run-local memoized outputs
+     admit ready node: acquire all requested slots/locks atomically
+     adapter.forkInputs(resolvedValues, node): Effect<InputLease> [remap Workspace inputs only]
+     execute declared leaf with existing retry/timeout boundary
        ActionExecutor.execute({ stepId, options, run(attempt) })  [when configured]
        CommandExecutor.execute({ workspace, stepId, onOutput, ... })
        WorkspacePersistence.commit({ workspace, stepId, workflowId })
+     publish typed output only after successful body/commit
+     finally: settle command/rollback, dispose lease, release slots/locks
+     readiness update → admit other eligible nodes
+   GraphRun.observe(): Effect<RunSnapshot>               [same owner as run]
+   GraphRun.cancel(): Effect<void>                       [interrupt + await cleanup]
      runtime event handler / command onOutput callback  [observers, not dispatch authority]
```

Prerequisite resolution moves from demand-driven action construction into the
opt-in scheduler's declared-needs resolver. Executable bodies and their existing
policy/checkpoint boundaries do not become scheduler callbacks that rediscover
dependencies. A target waiting for prerequisites holds no admission slots.
Backoff releases active-body slots, reacquiring them before retry; retries retain
their own owned workspace state under the existing policy, never another action's
mutable revision. Adapters must distinguish retained workspace/storage limits
from active execution slots rather than claiming they are interchangeable.
Non-workspace typed values pass through unchanged. Workspace inputs become
private mutable forks of the producer's committed revision; reports are not
silently converted into workspaces. `Graph.start` requires a caller-owned scope,
so neither cancellation nor a caller failure leaves detached work behind.

### Failure, cancellation and observation

- Preserve collect-all independent work, not an implicit global fail-fast switch.
  Required failure blocks dependent admission, including the aggregate, while
  unrelated eligible nodes may settle. A failed attempt is not a successful
  output; only the existing successful/reused result can satisfy a required edge.
- Advisory warnings, branch selection, retries and rollback ordering retain
  their current contracts. Missing optional outputs need their existing explicit
  handling; no fabricated success or guessed branch value. Conditional subgraph
  work belongs to [#147](https://github.com/ericclemmons/effect-ci-testbed/issues/147).
- Cancellation closes admission first, interrupts owned active work, awaits
  command termination and existing compensation/finalizers, and releases every
  lease/slot exactly once even after fork/start failure. Cleanup failure is
  reported, not success. Compensation may need retained leases; do not destroy
  them before rollback finishes. No resurrection of a cancelled ready queue.
- Shared prerequisites use one run-local memo entry, including concurrent
  consumers. This is not durable exactly-once execution across process crashes,
  redelivery, or fresh attempts. Reuse across attempts remains the existing
  verified result-cache policy, never blanket reuse of external writes.
- Plan/status shows selected closure, edges, effective limits, capability
  support, waiting-for-dependency versus waiting-for-capacity, and terminal
  blockers. Observation callbacks cannot consume capacity or cause dependents
  to run; keep existing observer-failure isolation. Reuse existing run/action
  correlation; [#168](https://github.com/ericclemmons/effect-ci-testbed/issues/168)
  owns identity changes. No new correlation/journal contract here.

## Backend gaps and proof limits

| Runner | What exists | Gap before the proposed contract can be supported |
| --- | --- | --- |
| Recipe file-copy adapter | Per-action copies from committed snapshots; typed values; normal-run disposal | No budget admission or capability negotiation; child processes do not implement scheduler cancellation/termination. Filesystem separation is not a security sandbox. |
| Default Local | Shell commands in local directories | No per-action mutable workspace fork guarantee. Reject this graph's isolation request rather than run it in one directory. |
| LocalContainer | One runner/container and mounted host workspace | Do not equate container execution with isolated per-action forks. Needs an isolation/lease adapter plus budget and termination support. |
| Cloudflare | Per-step container routing and workspace snapshot/commit primitives | No graph scheduler/admission/group-cancellation contract proved. Needs bounded dispatch, lease cleanup and native retry/checkpoint integration evidence; no deployment performed here. |

The [LocalContainer implementation](../../packages/local-container/src/index.ts)
and [Cloudflare runner](../../packages/cloudflare/src/index.ts) establish these
boundaries; explicit snapshot or matrix receipts do not prove graph scheduling.

The baseline's overlap/count/aggregate evidence proves only today's explicit
fanout on trusted local file copies. The count assertion plus one emitted
preparation record demonstrates this run, not crash-safe exactly-once behavior.
Timing uses one host's wall clock and is not a distributed-clock measurement.

Local baseline execution on October 26, 2026 recorded preparation count **1**,
left interval **1793067796361–1793067796863 ms**, right interval
**1793067796352–1793067796854 ms**, overlap **493 ms**, and aggregate start
**1793067797202 ms** (Unix milliseconds). Both reports carried the same
preparation token and different temporary paths. The separate CLI multi-target
run also prepared once and overlapped; it intentionally had no aggregate.

Before automatic scheduling is advertised: run the same fixture at budgets one
and two, compare overlap and dependency order, prove no new dependent work after
required failure, preserve serial side effects, and exercise cancellation during
dependency wait, admission, fork, command and retry/cleanup failure. Include
advisory/condition/retry parity and each claimed backend's own receipts. Existing
tests may run, but adding/changing tests needs Eric's approval. None of these
missing automatic-scheduler proofs is replaced by this explicit baseline.

## Compatibility decision

**Recommended:** add a separate opt-in `CI.target` / `CI.graph` contract. Existing
workflows and CLI selection keep their current ordering and failure semantics;
only authors migrating to declared needs get budgeted automatic dispatch.

| Choice | Benefit | Cost |
| --- | --- | --- |
| Separate opt-in graph | Preserves existing side-effect order; explicit migration and preflight boundary | New authoring surface; legacy and graph paths coexist |
| Reinterpret existing workflows | Less new syntax | Cannot safely infer dependency independence from arbitrary Effect code; incompatible without explicit migration rules |

Human approval of the opt-in boundary is required before implementing or routing
execution through the new scheduler. #171 stays open: design approval, scheduler,
runner support, concurrency-cap and side-effect regressions, and per-runner
automatic receipts remain outstanding. No gang scheduling, reservations across
runs, preemption, hosted spend, or unrelated identity/condition redesign is included.
