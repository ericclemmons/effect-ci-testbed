# CLI plan graphs

The CLI owns graph construction and visualization. Workflow authors keep using
`CI.action` and `CI.workflow`; `effect-ci plan --format=mermaid|dot` inspects the
existing workflow. There is no public SDK graph utility or separate planning
entry point.

The following changes are implemented in [draft PR #448](https://github.com/ericclemmons/effect-ci-testbed/pull/448).
The landed baseline is `main` at `c0f28e318322ba55f28b37cb65e1ccd490ec7f29`.
Signatures are abbreviated.

```diff
 CLI plan --format=text|json|mermaid
   CI.run(workflow, { mode: "plan" }): Effect<RunResult>
     interpret -> action discovery -> WorkflowPlan
     existing event callbacks and attempt persistence
     failure -> runtime.unwind(error) -> registered rollback actions
-  CI.formatPlanMermaid(plan): string
+  CLI formatPlanMermaid(plan): string
+    private toPlanGraph(plan) -> styled Mermaid
+CLI plan --format=dot
+  CLI formatPlanDot(plan): string
+    private toPlanGraph(plan) -> Graph.toGraphViz(...)
```

`toPlanGraph` stores complete PlanNode payloads. Edges point prerequisite to
consumer and retain dependency, ordering (`after`), and rollback kinds. Action IDs
stay in node payloads; numeric graph indices belong to that graph view. Duplicate
IDs and missing endpoints raise WorkflowPlanError. Recovery edges may form cycles,
so the complete visualization is not an execution DAG.

[Internal graph construction](./src/plan.ts#symbol=toPlanGraph "source")

Effect Graph represents the known relationships; action interpretation and native
tool adapters still discover them. Incoming traversal can answer prerequisite
questions, and outgoing traversal over dependency edges can find affected
consumers. Graph does not infer dependencies hidden in shell commands or arbitrary
Effect programs. Runtime edge storage, rerun analysis, and scheduling are outside
this change. The installed Effect 4.1.2 Graph module is marked unstable.

[Effect Graph reference](https://effect.website/docs/v4/api/effect/Graph)

Effect's Mermaid exporter has no per-edge style callback. The CLI renderer reads
Graph nodes and edges and keeps dotted ordering arrows and labeled rollback
arrows. It disambiguates action IDs whose sanitized Mermaid IDs collide. DOT
uses Effect's exporter and labels each relationship kind.

[Mermaid renderer](./src/plan.ts#symbol=formatPlanMermaid "source")

[DOT exporter](./src/plan.ts#symbol=formatPlanDot "source")
