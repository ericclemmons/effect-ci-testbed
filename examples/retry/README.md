# Retry a flaky test

Give a transient failure another chance, with a bounded delay.

[Source](./.cloudflare/ci/actions.ts#symbol=flaky "source")

## Run it

```sh
cd examples/retry
effect-ci run
```

The check deliberately fails on `CI.Attempt` 1 and passes on attempt 2.
One retry means two total attempts.

Use retries for operations safe to repeat. They do not make external writes
idempotent. See [timeouts and execution policy](../execution-policy).

[Actions](./.cloudflare/ci/actions.ts)
