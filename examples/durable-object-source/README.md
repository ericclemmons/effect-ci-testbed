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

## Conventional GitHub comparison

[Conventional runner](../source-comparison.ts "source")

The manual [comparison workflow](../../.github/workflows/source-comparisons.yml)
can validate the fixed manifest on the host and give only decoded files to a
network-disabled container, without Effect CI. It has not run against a Durable
Object on GitHub. The current store exposes host-only RPC, not an HTTP reader.

A private, fixed-revision read capability needs separate approval and
implementation before `DO_COMPARISON_MANIFEST_URL` can be configured. Do not
publish the store, add a generic writer or substitute a GitHub artifact for it.
An issuer receipt must bind that capability to the existing `owned-source`
object and digest. Local and Effect-on-GitHub recipe checks read checked-in
files, not the object. See [coverage and authority](../remaining-coverage.md).
