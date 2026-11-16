# Checkout from a Durable Object

Keep immutable CI inputs in SQLite-backed storage and pass only their files to
the workload.

The host stores a file manifest under its SHA-256 revision. Checkout reads that
revision, validates it, and returns a workspace. Later actions do not need the
storage binding.

The snippets on this page come from this example's files, which CI runs end to
end.

## Write a check against the checked-out files

Create `.cloudflare/ci/actions.ts`. The check reads a file from the checked-out
workspace. It does not know where the source came from:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source {11}")

Create `.cloudflare/ci/workflow.ts` to run it:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

The Worker below runs a standalone variant,
[`.cloudflare/ci/standalone.ts`](./.cloudflare/ci/standalone.ts). It also checks
the exact restored bytes and that no storage credentials reach the container.

## Try it

```sh
cd examples/durable-object-source
effect-ci run .cloudflare/ci/standalone.ts
```

This command uses local files. The storage-backed version follows.

## Store source in a Durable Object

In your Worker, import the
[durable-source adapter](../../packages/cloudflare/src/durable-source.ts) and
export its `SourceRevisions` Durable Object:

[`src/worker.ts`](./src/worker.ts#L1-L10 "source {6,9}")

The Workflow seeds a revision with `storage.put`, then gives Effect CI a source
whose `checkout` reads that revision and materializes its files in the
workspace container. Its deployed example accepts a fixed `owned-source`
fixture:

[`src/worker.ts`](./src/worker.ts#symbol=DurableSourceWorkflow "source 'storage.put(revision, bytes)' 'readDurableSource(storage, revision)' 'materializeSource(files, container)'")

Declare the Durable Objects, the workspace container, and the Workflow in
`cloudflare.config.ts`:

[`cloudflare.config.ts`](./cloudflare.config.ts "source {11}")

Writes are create-only: identical content can be reused; conflicting content
cannot overwrite a revision. The small manifest format is limited to 64 KiB
of decoded source. See [R2](../r2-source) for object-storage inputs instead.
