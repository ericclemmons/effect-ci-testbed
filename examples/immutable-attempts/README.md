# Keep rerun history and reuse passed steps

Start a new attempt without erasing the failed run or repeating unrelated work.

[Source](./.cloudflare/ci/tests/immutable-attempts.test.ts#symbol=second "source")

Rerunning test also reruns build, which consumes it. Checkout, install, lint,
and format reuse their previous outputs. The original attempt stays unchanged.

## Run it

```sh
pnpm exec effect-ci run --workflow examples/immutable-attempts/.cloudflare/ci/workflow.ts
```

See the [rerun code](./.cloudflare/ci/tests/immutable-attempts.test.ts) for retaining
an attempt via `onAttempt` even when execution fails.

[Workflow](./.cloudflare/ci/workflow.ts)
