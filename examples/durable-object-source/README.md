# Checkout from a Durable Object

Keep immutable CI inputs in SQLite-backed storage and pass only their files to
the workload.

The host stores a file manifest under its SHA-256 revision. Checkout reads that
revision, validates it, and returns a workspace. Later actions do not need the
storage binding.

## Try it

```sh
pnpm exec cf-ci run --workflow examples/durable-object-source/.cloudflare/ci/standalone.ts
```

This command uses local files. For the storage-backed version, the
[Worker](./src/worker.ts) supplies the
[durable-source adapter](../../packages/cloudflare/src/durable-source.ts).
Its deployed example accepts a fixed `owned-source` fixture.

Writes are create-only: identical content can be reused; conflicting content
cannot overwrite a revision. The small manifest format is limited to 64 KiB
of decoded source. See [R2](../r2-source) for object-storage inputs instead.
