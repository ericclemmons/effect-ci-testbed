# Checkout from R2

Use files stored in a private bucket as CI input, without giving R2 credentials
to the workload.

The host reads a manifest through `SOURCE_BUCKET`, checks its SHA-256, and supplies
a workspace through `CI.Source`. The next action restores that workspace and
reads `source.txt`.

## Try the local files

```sh
cd examples/r2-source
effect-ci run
```

## Use the R2 provider

The [configuration](./cloudflare.config.ts) and [Worker](./src/worker.ts) own the
bucket binding and native workflow. Upload [source.json](./source.json) to your
private bucket, then dispatch `effect-ci-r2-source-checks` with its object key as
`repository` and the raw manifest's SHA-256 as `revision`.

Object keys follow `source/<sha256>.json`. Changing the contents requires a new
digest. The manifest supports regular files and executable bits, up to 64 KiB
of decoded source; it is not an archive or a Git clone.
