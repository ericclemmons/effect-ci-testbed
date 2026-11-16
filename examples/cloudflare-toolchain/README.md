# Install Python on Cloudflare

Add Python to a shared runner without maintaining a custom image.

The snippets on this page come from this example's files, which CI runs end to
end.

## Prepare the toolchain in an action

Create `.cloudflare/ci/actions.ts`. Check out the source, then add a prepare
action. It installs Python and pip through `CI.PackageManager.Apt`, then installs
pinned Python build tools:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L11 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=preparePython "source {5-6}")

The build consumes the prepared workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source")

Create `.cloudflare/ci/workflow.ts`. It builds on manual runs:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Add the runner adapter

The runner adapter in `src/worker.ts` preserves the prepared workspace between
actions:

[`src/worker.ts`](./src/worker.ts#symbol=EffectCIWorkflow "source")

## Run it on Cloudflare

After deploying the [example host](../../test/apps/example-runner):

```sh
cf workflows instances create effect-ci-example-python-toolchain --body '{"instance_id":"python-build-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

The result is a wheel and source archive. Local command execution needs a
Debian-based environment with permission to install apt packages.
