# CI.action

Use `CI.action(id, construction, options?)` for a named operation that owns its
prerequisites. The returned function is callable from another action or exported
as a CLI target. Shared prerequisites run once per workflow run.

The construction resolves dependencies and returns the function that performs
the work. Returning a workspace carries its revision to dependent actions.
Use `CI.action<Result>` when the result is intentionally another type.

[Example](../../examples/exported-actions/.cloudflare/ci/actions.ts#symbol=check "source")

A direct `effect-ci run check` still resolves checkout because the action owns
that dependency. Ordering only in a default workflow cannot provide this guarantee.

Retries and timeouts belong in the third argument. A rollback action runs after
terminal failure; earlier registered rollback actions unwind in reverse completion
order. Cancellation does not promise that an external side effect was undone.

[Retry and timeout options](./src/index.ts#symbol=WorkflowStepConfig "source")

[Rollback option](./src/index.ts#symbol=ActionOptions "source")

[Exports](../../examples/exported-actions) · [Retries](../../examples/retry) ·
[Rollback](../../examples/rollback-compensation) · [Timeouts](../../examples/execution-policy)
