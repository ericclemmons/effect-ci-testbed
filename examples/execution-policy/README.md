# Set retry and timeout limits

Retry a build without repeating its installation dependency.

[Source](./.cloudflare/ci/actions.ts#symbol=flaky "source")

Resolve prerequisites first, then return the body the runner may retry.
`limit: 2` allows three attempts; the timeout applies to each attempt.

## Run it

```sh
pnpm exec cf-ci run --workflow examples/execution-policy/.cloudflare/ci/workflow.ts
```

Local execution uses Effect's retry/timeout operators. Cloudflare uses native
Workflow checkpoints. Repeated commands can repeat external effects, so choose
idempotent operations or a provider's deduplication mechanism.

[Workflow](./.cloudflare/ci/workflow.ts) · [Rollback](../rollback-compensation)
