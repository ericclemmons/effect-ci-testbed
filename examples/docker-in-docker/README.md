# Build and run Docker in CI

Run a project's Dockerfile inside a Cloudflare CI container.

This builds an inner project image; [custom runner images](../custom-runner-image)
configure the outer environment.

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with your Dockerfile

Use your project's existing Dockerfile. This example's image prints one file:

[`app/Dockerfile`](./app/Dockerfile "source")

## Define the actions

Create `.cloudflare/ci/actions.ts`. These actions are portable: they run the
same way locally and on Cloudflare. Start with the SDK import and a checkout
action:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Build the project's image from the `app` directory:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=buildImage "source 'docker build --network=host --tag effect-ci-user-image app'")

Run the built image:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=runImage "source 'docker run --network=host --rm effect-ci-user-image'")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Running the image builds it first:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {5}")

## Run it locally

```sh
cd examples/docker-in-docker
effect-ci run
```

Locally, the same actions use the host's Docker daemon; no nested daemon starts.

## Run it on Cloudflare

On Cloudflare, the actions run inside a CI container that starts its own Docker
daemon.

Create the outer image. It supplies Docker and the Sandbox shim:

[`Dockerfile`](./Dockerfile "source {1,6-8}")

Add the container, its Durable Object, and the Workflow to `wrangler.jsonc`:

[`wrangler.jsonc`](./wrangler.jsonc#L7-L38 "source")

Create the Worker. Its Workflow entrypoint starts the nested Docker daemon and
waits until `docker info` succeeds before running actions:

[`src/worker.ts`](./src/worker.ts "source {13-24}")

After deploying the Worker:

```sh
cf workflows instances create effect-ci-docker-in-docker --body '{"params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

Use the Workflow name in your deployed configuration. The local Container
emulator lacks the kernel privileges this nested daemon needs.
