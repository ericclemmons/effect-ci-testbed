# Set retry and timeout limits

Retry a build without repeating its installation dependency.

The snippets on this page come from this example's files, which CI runs end to
end.

## Add a retry policy

In `.cloudflare/ci/actions.ts`, import the SDK and Effect:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L2 "source")

Pass `retries` as the action's options. This
action fails on its first two attempts, then succeeds. `limit: 2` allows three
attempts:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=flaky "source {9}")

`CI.Attempt` gives the current attempt number.

## Add a timeout

Pass `timeout` the same way. The timeout applies to each attempt:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=slow "source {3}")

## Retry only the body

Resolve prerequisites first, then return the body the runner may retry or time
out. Here, checkout is the prerequisite and the returned command is the body:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=hangingCommand "source {2,4}")

The example's test checks that this timeout interrupts the child process:

[`.cloudflare/ci/tests/execution-policy.test.ts`](./.cloudflare/ci/tests/execution-policy.test.ts#L21-L29 "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/execution-policy
effect-ci run
```

Local execution uses Effect's retry/timeout operators. Cloudflare uses native
Workflow checkpoints. Repeated commands can repeat external effects, so choose
idempotent operations or a provider's deduplication mechanism.

See also [Rollback](../rollback-compensation).
