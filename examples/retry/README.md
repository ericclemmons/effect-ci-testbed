# Retry a flaky test

Give a transient failure another chance, with a bounded delay.

The snippets on this page come from this example's files, which CI runs end to
end.

## Add a retry policy to the check

In `.cloudflare/ci/actions.ts`, pass a `retries` option to the check. One retry
means two total attempts, with a constant 1 second delay between them. To
simulate a transient failure, this check reads `CI.Attempt`, fails on attempt 1,
and passes on attempt 2:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source {10}")

Use retries for operations safe to repeat. They do not make external writes
idempotent. See [timeouts and execution policy](../execution-policy).

## Run the check from the workflow

Call the check from `.cloudflare/ci/workflow.ts`. The workflow needs nothing
retry-specific:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/retry
effect-ci run
```
