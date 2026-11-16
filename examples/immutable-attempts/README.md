# Keep rerun history and reuse passed steps

Start a new attempt without erasing the failed run or repeating unrelated work.

Rerunning test also reruns build, which consumes it. Checkout, install, lint,
and format reuse their previous outputs. The original attempt stays unchanged.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Each action calls the one it needs. Lint,
format, and test each need install; build needs test:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=test "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source 'yield* test()'")

Checkout, install, lint, and format follow the same shape. See the
[full actions file](./.cloudflare/ci/actions.ts).

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It runs lint and an optional format in
parallel, then build:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/immutable-attempts
effect-ci run
```

## Rerun one step from code

This example's test runs the workflow twice. Its stand-in executor fails the
test step on the first run. Pass
`onAttempt` in the run options to keep each attempt, even when execution fails:

[`.cloudflare/ci/tests/immutable-attempts.test.ts`](./.cloudflare/ci/tests/immutable-attempts.test.ts#L26-L28 "source")

Then start a second attempt from the first, and name the steps to rerun:

[Rerun test](./.cloudflare/ci/tests/immutable-attempts.test.ts#symbol=second "source {3}")

The second attempt runs only test and build. It links to the first through
`previousAttemptId`, and the first attempt's record does not change.

## Compare with GitHub Actions

In GitHub Actions, **Re-run failed jobs** keeps the earlier attempt and reuses
jobs that passed. Reuse is per job, and each job starts from a fresh checkout, so
each reusable step must be its own job:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L43 "source")
