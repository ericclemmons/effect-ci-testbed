# Checkout from Cloudflare Artifacts

Build a commit stored in Artifacts without putting Git credentials in a container.

A Worker reads the commit through its `ARTIFACTS` binding and supplies
`CI.Source` to the workflow. Actions receive files, not the storage client.

The snippets on this page come from this example's files, which CI runs end to
end.

## Check out through `CI.Source`

Create `.cloudflare/ci/actions.ts`. The `checkout` action asks for `CI.Source`
instead of running `git`, so the same action works with local files or with
Artifacts:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L2 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source {2}")

The check reads a file from the checked-out workspace to prove the source arrived:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=verify "source")

Create `.cloudflare/ci/workflow.ts`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Supply the source from a Worker

Create `src/worker.ts`. The Workflow entrypoint validates the repository name,
full commit SHA, and optional directory. Its `source.checkout()` reads the files
from Artifacts and writes them into the workspace container:

[`src/worker.ts`](./src/worker.ts#symbol=ArtifactsSourceWorkflow "source 'this.env.ARTIFACTS.get' 'readArtifactSource' 'materializeSource'")

The Worker has no public dispatch route. Starting the Workflow requires
Cloudflare account authorization:

[`src/worker.ts`](./src/worker.ts#symbol=default "source")

## Configure the binding

In `cloudflare.config.ts`, bind `ARTIFACTS` to a namespace and export the
workspace container and the Workflow:

[`cloudflare.config.ts`](./cloudflare.config.ts "source 'bindings.artifacts'")

The workspace image needs no Git or credentials:

[`Dockerfile`](./Dockerfile "source")

## Run it

After installing repository dependencies, with an authorized Cloudflare account:

```sh
cd examples/artifacts-source
cf deploy
cf artifacts namespaces repos import my-ci-source --namespace default --url https://github.com/OWNER/REPO --branch main --read-only
cf workflows instances create effect-ci-artifacts-source-checks --body '{"instance_id":"my-artifacts-run","params":{"repository":"my-ci-source","revision":"FULL_COMMIT_SHA","directory":"examples/artifacts-source"}}'
```

Use an Artifacts repository name—not a GitHub URL—in `repository`. Omit
`directory` when the example is at that repository's root. This small-file
exporter supports at most 64 KiB of source, not a whole monorepo.

From the repository root, use local files instead:

```sh
cd examples/artifacts-source
effect-ci run
```
