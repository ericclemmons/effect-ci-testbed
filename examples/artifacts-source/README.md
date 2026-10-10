# Cloudflare Artifacts source

> How do I materialize commit-pinned source through a Worker binding without putting Git credentials in the container?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_verify_Artifacts_source["verify Artifacts source"]
  step_checkout --> step_verify_Artifacts_source
```

---

The [hosted provider](../../apps/example-runner/src/artifacts-source.ts) reads
`examples/artifacts-source` through the private Artifacts binding at an immutable
40-character commit SHA. It materializes regular files, binary contents, and
executable bits. Checkout creates a workspace snapshot; the downstream check
restores it and reads `source.txt`. No Git token enters the container.

Import the repository and deploy the [example host](../../apps/example-runner):

```sh
cf artifacts namespaces repos import my-ci-source --namespace default --url https://github.com/OWNER/REPO --branch main --read-only
cf workflows instances create effect-ci-example-artifacts-source --body '{"instance_id":"my-artifacts-run","params":{"repository":"my-ci-source","revision":"FULL_COMMIT_SHA"}}'
```

The import command may issue a Git token; this provider does not use it. Revoke
that token if unused. The exporter rejects mutable refs, symlinks, submodules,
traversal, missing objects, and manifests exceeding its bounded limits: 64 KiB
decoded content, 96 KiB encoded manifest, 1,000 entries, and 32 directory levels.
This is a small source materializer, not a full clone or streaming exporter.

Run the workflow against the local directory with the same source contract:

```sh
cf-ci run --workflow examples/artifacts-source/.cloudflare/ci/workflow.ts
```

See [source-provider composition](../source-providers) for filesystem/Git layers,
and the [Artifacts binding API](https://developers.cloudflare.com/artifacts/api/workers-binding/).
