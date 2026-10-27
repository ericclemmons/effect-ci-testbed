# Checkout from R2

Use files stored in a private bucket as CI input, without giving R2 credentials
to the workload.

The host reads a manifest through `SOURCE_BUCKET`, checks its SHA-256, and supplies
a workspace through `CI.Source`. The next action restores that workspace and
reads `source.txt`.

## Try the local files

```sh
pnpm exec cf-ci run --workflow examples/r2-source/.cloudflare/ci/workflow.ts
```

## Use the R2 provider

The [configuration](./cloudflare.config.ts) and [Worker](./src/worker.ts) own the
bucket binding and native workflow. Upload [source.json](./source.json) to your
private bucket, then dispatch `effect-ci-r2-source-checks` with its object key as
`repository` and the raw manifest's SHA-256 as `revision`.

Object keys follow `source/<sha256>.json`. Changing the contents requires a new
digest. The manifest supports regular files and executable bits, up to 64 KiB
of decoded source; it is not an archive or a Git clone.

## Conventional GitHub comparison

[Conventional runner](../source-comparison.ts "source")

The manual [comparison workflow](../../.github/workflows/source-comparisons.yml)
fetches the fixed fixture on the host using a short-lived HTTPS read capability,
validates the same manifest contract, then gives only decoded files to a
network-disabled container. It does not run Effect CI or the Effect workflow.

It has not run against R2 on GitHub. The `R2_COMPARISON_MANIFEST_URL` secret must
be issued for the existing bucket and exact digest, with separate authority and
an issuer receipt. Do not use a copied Git fixture or a workflow result as R2
checkout evidence. Local and Effect-on-GitHub recipe checks currently read the
checked-in `source.txt`, not the private bucket. See [coverage](../remaining-coverage.md).
