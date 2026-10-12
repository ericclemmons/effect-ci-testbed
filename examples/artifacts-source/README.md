# Cloudflare Artifacts source

> How do I materialize commit-pinned source through a Worker binding without putting Git credentials in the container?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_verify_Artifacts_source["verify Artifacts source"]
  step_checkout --> step_verify_Artifacts_source
```

---

This directory owns its deployable Worker, Artifacts binding, native Workflow,
Dockerfile, Vite configuration, portable actions, and source fixture. It imports
reusable library packages, not another example or app.

## Follow the wiring

1. [cloudflare.config.ts](./cloudflare.config.ts) declares `ARTIFACTS` in the
   `default` namespace and registers `effect-ci-artifacts-source-checks`.
2. [src/worker.ts](./src/worker.ts) explicitly reads `env.ARTIFACTS.get(repository)`,
   exports an immutable commit and materializes files into its own container.
3. It injects that checkout as `CI.Source` into the portable
   [.cloudflare/ci/workflow.ts](./.cloudflare/ci/workflow.ts).

No inference selects Artifacts: dispatching this native Workflow selects its
explicit provider. `repository` is an **Artifacts repository name**, not a GitHub
URL. The repository may originally have been imported from GitHub.

## Deploy this example

Install this monorepo's dependencies with `pnpm install`, then deploy from here:

```sh
cd examples/artifacts-source
cf deploy
cf artifacts namespaces repos import my-ci-source --namespace default --url https://github.com/OWNER/REPO --branch main --read-only
cf workflows instances create effect-ci-artifacts-source-checks --body '{"instance_id":"my-artifacts-run","params":{"repository":"my-ci-source","revision":"FULL_COMMIT_SHA","directory":"examples/artifacts-source"}}'
cf workflows instances get my-artifacts-run --workflow-name effect-ci-artifacts-source-checks
```

Use your repository URL and full commit SHA. `directory` selects the folder in
the imported commit. If you copy this example into its own repository root, omit
`directory` (the default is the root). Do not export this monorepo's entire root;
the materializer deliberately supports only small source trees.

The import command may issue a Git token; this provider does not use it. Revoke
that token if unused. The exporter rejects mutable refs, symlinks, submodules,
traversal, missing objects, and manifests exceeding its bounded limits: 64 KiB
decoded content, 96 KiB encoded manifest, 1,000 entries, and 32 directory levels.
This is a small source materializer, not a full clone or streaming exporter.
Binary contents and executable bits are preserved. Checkout creates a snapshot;
the downstream check restores it and reads `source.txt`. This recipe still uses a
container. The public Worker endpoint returns 404; native dispatch is authenticated
through Cloudflare's Workflow APIs. No Slack integration or release broker is installed.

## Local execution is different

Run the portable workflow against local files:

```sh
cf-ci run --workflow examples/artifacts-source/.cloudflare/ci/workflow.ts
```

That command does **not** verify the Artifacts binding. `cf dev` from this directory
instead starts this example's own Worker and native Workflow explorer. No shared
example host is required.

## Verification

The prior shared-host run `coverage-artifacts-focused-20261010-1` remains historical
provider evidence: three native steps completed after the import-issued token was
revoked, with downstream output `source from artifacts`. It is not proof of this
new independently deployed configuration; a new standalone hosted run is required.

See the [Artifacts binding API](https://developers.cloudflare.com/artifacts/api/workers-binding/).
