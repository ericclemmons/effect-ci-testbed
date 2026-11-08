# Set retry and timeout limits

Retry a build without repeating its installation dependency.

[Source](./.cloudflare/ci/actions.ts#symbol=flaky "source")

Resolve prerequisites first, then return the body the runner may retry.
`limit: 2` allows three attempts; the timeout applies to each attempt.

## Run it

```sh
cd examples/execution-policy
effect-ci run
```

Local execution uses Effect's retry/timeout operators. Cloudflare uses native
Workflow checkpoints. Repeated commands can repeat external effects, so choose
idempotent operations or a provider's deduplication mechanism.

[Workflow](./.cloudflare/ci/workflow.ts) · [Rollback](../rollback-compensation)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs the same retry loop as
the GitHub Actions comparison. `timeout-minutes: 1` becomes the step's native
Workflows `timeout`. It does not use Effect CI.

```sh
(cd examples/execution-policy/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs execution-policy
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
