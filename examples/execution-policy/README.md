# Set retry and timeout limits

Retry a build without repeating its installation dependency.

```ts
const build = CI.action("build", function* () {
  const workspace = yield* install()
  return () => workspace.exec("npm run build")
}, { retries: { limit: 2, delay: "1 second" }, timeout: "2 minutes" })
```

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
