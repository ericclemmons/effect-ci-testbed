# Checkout from a Durable Object

> How do I run CI against an immutable Durable Object source revision without handing the storage binding to the container?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_verify_Durable_Object_source["verify Durable Object source"]
  step_checkout --> step_verify_Durable_Object_source
```

The same `CI.Source` actions used by the [source-provider](../source-providers)
recipe receive a workspace, not a storage client. The host reads a SHA-256-pinned
regular-file manifest over RPC, verifies the exact bytes, materializes them into
the workspace, then checkpoints it. A separate downstream check restores that
checkpoint and reads `source.txt`. Compare [R2 source](../r2-source) for the same
input boundary with object storage; [portable artifacts](../portable-artifacts)
instead publishes build outputs.

`SourceRevisions` is a host-only SQLite Durable Object with `put(revision, bytes)`
and `get(revision)`. Writes are create-only; identical replay is idempotent.
There is no mutable `latest`, overwrite, delete, public HTTP writer, or source
binding in the container. Every read verifies its content address, including
persisted storage corruption. A transaction bounds each object to 32 revisions.
The shared manifest validator rejects traversal, links, conflicting paths,
noncanonical base64, and manifests over 96 KiB encoded / 64 KiB decoded / 1,000 files.

The administrative demo Workflow seeds only a fixed, tiny source manifest into
object `demo-source`; unknown object IDs or revisions fail before seeding.
General producers can use the RPC writer from trusted host code, not untrusted
container/project code. This is source storage, not arbitrary filesystem checkout.

Local filesystem variant (not proof of the DO provider):

```sh
pnpm cf-ci --workflow examples/durable-object-source/.cloudflare/ci/workflow.ts
```

Real SQLite/RPC adapter test (local Workers runtime):

```sh
node --test apps/example-runner/src/durable-source-runtime.test.ts
```

After deploying the [example host](../../apps/example-runner) with `cf deploy`,
dispatch its authenticated native Workflow:

```sh
cf workflows instances create effect-ci-example-durable-source --body '{"instance_id":"my-do-source-run","params":{"repository":"demo-source","revision":"c79e699009991bf593f593ae81b03241c6de16447d4598ba66bee96d8b2eeed9"}}'
```

The reference is `{ kind: "durable_object", id, revision }`; parameters retain
the portable `repository`/`revision` shape. The demo manifest's SHA256 pins the
exact canonical bytes produced by [the host](../../apps/example-runner/src/durable-source.ts).
Hosted run `coverage-do-source-20261012-1`, Workflow version
`836817de-4c45-44fc-9975-3368e9998fea`, host deployment
`9ec15a33-51b4-402a-a221-cf4597a60a6e`, completed the real DO seed/read,
materialization and checkpoint `94e936dc-b227-4717-817c-a7b21668a24e`. The separate
downstream native read restored `source from durable object`. Local SQLite/RPC
tests and the local filesystem recipe also passed. GitHub columns remain
unverified until their actual jobs pass. No notification is sent by this recipe.

## Verification proof

**Video:** Pending — no same-run recording has been published for this recipe.

**Measured results:** Pending — no structured per-environment timing summary has
been published here. Existing recorded runs and coverage claims remain as documented;
missing media or measurements do not imply those runs failed or were never verified.

Use the [proof-page contract](../PROOF-PAGES.md) for exact revision/environment,
assertions, video/transcript, outcome and cold/warm timings. See the
[coverage matrix](../../README.md#recipes-by-feature) for current backend support.
