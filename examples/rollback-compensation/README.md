# Compensate only after retries are exhausted

This example answers one question:

> If deployment still fails after retrying, how does its recovery remain visible?

`CI.compensate(primary, recovery)` records a recovery edge in the plan. The primary
action's runner-owned retry policy completes first. Recovery runs once only after the
terminal failure; it is not another retry and it does not pretend external state can be
rewound by restoring a filesystem snapshot.

If recovery succeeds, the original failure remains the workflow failure. If recovery
also fails, `CI.CompensationError` preserves both errors.

The conventional GitHub Actions comparison needs `continue-on-error` so its rollback
step can run, followed by a final step that deliberately restores the original failing
conclusion. Effect CI keeps that control flow as one inspectable recovery edge.

Run the canonical workflow locally:

```sh
./examples/rollback-compensation/.cloudflare/ci/workflow.ts
```

Compare [the conventional GitHub workflow](./.github/workflows/github.yml) with
[Effect on GitHub](./.github/workflows/effect-on-github.yml). Forced failure and
double-failure assertions live in
[`tests/rollback-compensation.test.ts`](./.cloudflare/ci/tests/rollback-compensation.test.ts).
