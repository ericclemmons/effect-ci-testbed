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
