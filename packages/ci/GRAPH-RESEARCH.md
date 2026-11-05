# Effect Graph for plan inspection

Research date: 2026-11-04. Landed baseline: `origin/main` at
`c0f28e318322ba55f28b37cb65e1ccd490ec7f29`. The Graph view described below is
implemented on this branch and remains unmerged.

## Decision

Use Effect Graph as a derived view of the serializable WorkflowPlan. Keep action
discovery and execution in the CI runtime. The repository already depends on
Effect 4.1.2; no dependency change is required. Graph itself is marked unstable.

[Effect dependency](https://github.com/ericclemmons/effect-ci-testbed/blob/c0f28e318322ba55f28b37cb65e1ccd490ec7f29/packages/ci/package.json)

[Graph reference](https://effect.website/docs/v4/api/effect/Graph)

The SDK action/workflow guidance and landed implementation agree: actions own
prerequisites, workflows select goals, and interpreting action calls discovers
relationships. Ordinary runtime branches do not expose both branches in a plan.
No separate Graph migration guide or existing Graph integration was found in the
inspected repository. Installed Effect 4.1.2 source supplies concrete API prior art.

[Action guidance](./ACTION.md)

[Workflow guidance](./WORKFLOW.md)

[Baseline implementation](https://github.com/ericclemmons/effect-ci-testbed/blob/c0f28e318322ba55f28b37cb65e1ccd490ec7f29/packages/ci/src/index.ts)

## Implemented boundary

`toPlanGraph` stores complete PlanNode payloads. Edges point prerequisite to
consumer and retain dependency, ordering (`after`) and rollback kinds. Action IDs
remain in node payloads; numeric graph indices belong to that graph view.
Duplicate IDs and missing endpoints raise WorkflowPlanError. Recovery edges may
form cycles, so the complete visualization is not an execution DAG.

[Graph construction](./src/index.ts#symbol=toPlanGraph "source")

Full call diff against the landed baseline; signatures are abbreviated:

```diff
 CI.run(workflow, options): Effect<RunResult>
   interpret -> action discovery -> toPlan(...): WorkflowPlan
   existing event callbacks and attempt persistence
   failure -> runtime.unwind(error) -> registered rollback actions
+CI.toPlanGraph(plan): DirectedGraph<PlanNode, PlanEdge>
+  validate IDs/endpoints -> dependency/after/rollback edges
 CLI plan --format=mermaid
-  formatPlanMermaid(plan) -> traverse plan arrays
+  formatPlanMermaid(plan) -> toPlanGraph(plan) -> styled Mermaid
+CLI plan --format=dot
+  formatPlanDot(plan) -> toPlanGraph(plan) -> Graph.toGraphViz(...)
```

Both renderers share graph construction and node labels. Effect's Mermaid
exporter has no per-edge style callback; the CI renderer preserves dotted
ordering arrows and labeled rollback arrows while reading nodes and edges from
Graph. It also disambiguates action IDs whose sanitized Mermaid IDs collide.
DOT uses Effect's exporter and labels each relationship kind.

[Mermaid renderer](./src/index.ts#symbol=formatPlanMermaid "source")

[DOT exporter](./src/index.ts#symbol=formatPlanDot "source")

## Future options

Incoming `dfs`/`bfs` traversal can answer transitive prerequisite questions;
outgoing traversal over value edges can identify affected consumers. `topo`
orders a selected dependency DAG, but does not schedule work or produce parallel
batches. Its `initials` option prioritizes roots rather than selecting a target
subgraph. Use traversal closure followed by `inducedSubgraph` for target selection.

[Traversal and analysis contracts](https://effect.website/docs/v4/api/effect/Graph)

Replacing runtime edge storage, rerun analysis, or scheduling is outside this
change. Native tool adapters still own discovery: for example, Turbo must produce
its native plan before CI can import those task relationships. Graph cannot
infer dependencies hidden in shell commands or arbitrary Effect programs.

[Turbo adapter](https://github.com/ericclemmons/effect-ci-testbed/blob/c0f28e318322ba55f28b37cb65e1ccd490ec7f29/packages/ci/src/turbo.ts)
