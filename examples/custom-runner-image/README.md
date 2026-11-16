# Customize the CI container

Bake tools into the runner image instead of installing them on every run.

This changes the environment that runs CI. To build your application's own
image, see [Build and publish a container image](../custom-container-image).

The snippets on this page come from this example's files, which CI runs end to
end.

## Write the Dockerfile

Start from Debian, add the tools your actions need (here Python), and copy in
the Sandbox shim. The container stays alive until the runner stops it:

[`Dockerfile`](./Dockerfile "source {4}")

## Use the tool in an action

Create `.cloudflare/ci/actions.ts`. The portable action only runs the tool; it
does not install it:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source")

Create `.cloudflare/ci/workflow.ts`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Select the image in the runner

In `src/worker.ts`, the Workflow entrypoint runs actions in the `workspace`
image:

[`src/worker.ts`](./src/worker.ts#symbol=EffectCIWorkflow "source {3}")

## Use it on Cloudflare

The [example runner configuration](../../test/apps/example-runner/cloudflare.config.ts)
builds this Dockerfile as its `workspace` image:

[Example runner configuration](../../test/apps/example-runner/cloudflare.config.ts#symbol=workspace "source {5}")

With Docker and an authorized Cloudflare account:

```sh
pnpm --filter @effect-ci-testbed/example-runner exec cf deploy
cf workflows instances create effect-ci-example-custom-runner-image --body '{"instance_id":"custom-image-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

Choose your own resource names before deploying into another account.
For tools that can install at runtime, see [system packages](../system-package).
