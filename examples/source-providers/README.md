# Checkout from local files or Git

Change where source comes from without changing the workflow.

The snippets on this page come from this example's files, which CI runs end to
end.

## Check out from `CI.Source`

In `.cloudflare/ci/actions.ts`, check out from `CI.Source` instead of naming a
location. A check then reads from the checked-out workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source {5}")

The workflow runs that check:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Write the providers

Create `.cloudflare/ci/providers.ts`. Each provider implements
`CI.SourceService`. Start with the imports:

[`.cloudflare/ci/providers.ts`](./.cloudflare/ci/providers.ts#L1-L3 "source")

One provider supplies a local directory:

[`.cloudflare/ci/providers.ts`](./.cloudflare/ci/providers.ts#symbol=filesystemSource "source")

The other supplies a Git clone at an immutable revision:

[`.cloudflare/ci/providers.ts`](./.cloudflare/ci/providers.ts#symbol=gitSource "source")

## Pass a provider to the run

Give the same workflow either provider as its `source`:

[`.cloudflare/ci/tests/source-providers.test.ts`](./.cloudflare/ci/tests/source-providers.test.ts#L29-L43 "source 'source: filesystem' 'source: remoteGit'")

## Try both

```sh
node --test examples/source-providers/.cloudflare/ci/tests/source-providers.test.ts
```

The same workflow reads files from either provider. Other providers implement
the same contract: [R2](../r2-source), [Artifacts](../artifacts-source),
[Durable Object storage](../durable-object-source), or [GitLab](../gitlab-source).
