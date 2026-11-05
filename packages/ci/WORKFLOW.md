# CI.workflow

Use `CI.workflow(id, body)` to select the goals for a run. It returns a workflow
definition; the CLI or `CI.run` executes it. Actions own their prerequisites;
the workflow coordinates them.

[Workflow](../../examples/snapshot-fanout/.cloudflare/ci/workflow.ts#symbol=workflow "source")

## optional

`CI.optional(action())` allows an action's recoverable failure to become a warning.
Required prerequisites still matter. It expects a CI action or step, rather than
an arbitrary Effect. Use it for optional checks without hiding required failures.

[Optional check](../../examples/optional-checks/.cloudflare/ci/workflow.ts#symbol=workflow "source")

## parallel

`CI.parallel([left(), right()])` runs goals concurrently. Shared prerequisites are
memoized. Filesystem isolation depends on the runner; parallel execution alone
does not create independent workspaces or a security boundary. Multiple failures
remain visible after the branches finish.

[Parallel checks](../../examples/snapshot-fanout) · [Matrix](../../examples/matrix)

## when

`CI.when(condition, action())` records an inspectable event/ref condition in the
plan and skips the action when execution does not match. Ordinary `if` works for
runtime decisions, including source and output comparisons, but does not put
both branches in the plan.

[Event condition](../../examples/ordered-deploy/.cloudflare/ci/workflow.ts#symbol=workflow "source")

[Conditions](../../examples/conditional-deploy)

## Inspect a plan

`CI.run(workflow, { mode: "plan" })` returns a result containing a serializable
`WorkflowPlan`.
`CI.toPlanGraph(plan)` derives an Effect directed Graph with the full plan nodes
as payloads. Edges point from prerequisites to consumers and carry one of
`dependency`, `after`, or `rollback`. Action IDs stay in node payloads; Graph's
numeric indices belong to that graph view.

[Plan graph](./src/index.ts#symbol=toPlanGraph "source")

Use Effect Graph's incoming traversal for prerequisites, outgoing traversal for
consumers, and its exporters for other visualizations. Filter to `dependency`
edges when asking which values invalidate downstream work. `after` edges only
constrain order; `rollback` edges describe recovery. The complete visualization
graph is not necessarily acyclic and does not schedule execution.

The CLI renders the same graph as Mermaid or Graphviz DOT:

```sh
effect-ci plan --format=mermaid
effect-ci plan --format=dot > plan.dot
dot -Tsvg plan.dot > plan.svg
```

Rendering DOT as SVG requires Graphviz. Mermaid keeps ordering arrows dotted and
labels rollback arrows. Both formats retain optional and conditional labels.
Plans include discovered relationships; runtime branches may reveal more during
execution.
