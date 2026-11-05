# Keep rerun history and reuse passed steps

Start a new attempt without erasing the failed run or repeating unrelated work.

[Source](./.cloudflare/ci/tests/immutable-attempts.test.ts#symbol=second "source")

Rerunning test also reruns build, which consumes it. Checkout, install, lint,
and format reuse their previous outputs. The original attempt stays unchanged.

## Run it

```sh
cd examples/immutable-attempts
effect-ci run
```

See the [rerun code](./.cloudflare/ci/tests/immutable-attempts.test.ts) for retaining
an attempt via `onAttempt` even when execution fails.

In the [GitHub Actions comparison](./.github/workflows/github.yml), **Re-run failed
jobs** keeps the earlier attempt and reuses jobs that passed. Reuse is per job, and
each job starts from a fresh checkout.

[Workflow](./.cloudflare/ci/workflow.ts)
