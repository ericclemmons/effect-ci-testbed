# Checkout from R2

Use files stored in a private bucket as CI input, without giving R2 credentials
to the workload.

The host reads a manifest through `SOURCE_BUCKET`, checks its SHA-256, and supplies
a workspace through `CI.Source`. The next action restores that workspace and
reads `source.txt`.

The snippets on this page come from this example's files, which CI tests.

## Write source-agnostic actions

The actions do not know where the source comes from. They call `CI.Source`, and
the host decides what checkout means. Create `.cloudflare/ci/actions.ts`:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source {5-6}")

Create `.cloudflare/ci/workflow.ts`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Try the local files

Locally, `CI.Source` checks out this directory, which already contains
`source.txt`:

```sh
cd examples/r2-source
effect-ci run
```

## Use the R2 provider

### Store the source as a manifest

Upload a manifest such as [`source.json`](./source.json) to your private bucket.
It lists each file as base64 with its executable bit:

[`source.json`](./source.json "source")

Object keys follow `source/<sha256>.json`. Changing the contents requires a new
digest. The manifest supports regular files and executable bits, up to 64 KiB
of decoded source; it is not an archive or a Git clone.

### Bind the bucket to the host Worker

The host Worker owns the bucket binding, the workspace container, and the native
workflow. The workload never receives the binding:

[`cloudflare.config.ts`](./cloudflare.config.ts "source {17,20}")

### Validate the dispatch parameters

The workflow accepts only an object key under `source/` and a SHA-256 digest. The
`repository` is an R2 key, never a Git URL or credential selector:

[`src/parameters.ts`](./src/parameters.ts#symbol=sourceParameters "source")

### Supply `CI.Source` from R2

In `src/worker.ts`, import the Effect CI host packages, the R2 reader, and the
workflow to run:

[`src/worker.ts`](./src/worker.ts#L1-L8 "source")

The workflow entrypoint builds a `CI.SourceService` whose `checkout` reads the
manifest from the bucket, checks its digest, and writes the files into the
workspace container. It then runs the workflow with that source:

[`src/worker.ts`](./src/worker.ts#symbol=R2SourceWorkflow "source 'readR2Source(this.env.SOURCE_BUCKET, parameters.repository, parameters.revision)' 'source,'")

The hosted workflow is [`.cloudflare/ci/standalone.ts`](./.cloudflare/ci/standalone.ts).
Its verifier runs in the restored container and also checks that no bucket
binding or storage credential reached the container environment:

[`.cloudflare/ci/standalone.ts`](./.cloudflare/ci/standalone.ts#symbol=verify "source")

### Dispatch a run

Deploy the Worker, then dispatch `effect-ci-r2-source-checks` with the
manifest's object key as `repository` and the raw manifest's SHA-256 as
`revision`.
