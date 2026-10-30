# Checkout from Cloudflare Artifacts

Build a commit stored in Artifacts without putting Git credentials in a container.

The [Worker](./src/worker.ts) reads through its `ARTIFACTS` binding and supplies
`CI.Source` to the [workflow](./.cloudflare/ci/workflow.ts). Actions receive files,
not the storage client.

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
