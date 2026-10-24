# Checkout from local files or Git

Change where source comes from without changing the workflow.

[Source](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[providers.ts](./.cloudflare/ci/providers.ts) supplies a local directory or a
Git clone at an immutable revision.

## Try both

```sh
node --test examples/source-providers/.cloudflare/ci/tests/source-providers.test.ts
```

The same workflow reads files from either provider. Other providers implement
the same contract: [R2](../r2-source), [Artifacts](../artifacts-source),
[Durable Object storage](../durable-object-source), or [GitLab](../gitlab-source).
