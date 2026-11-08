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

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs each attempt as its own
step, with a constant 1 second delay between them. The check fails on attempt 1
and passes on attempt 2. `step.runner()` can retry natively, but its command
cannot see the attempt number. It does not use Effect CI.

```sh
(cd examples/retry/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs retry
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
