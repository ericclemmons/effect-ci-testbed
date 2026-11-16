# Build and publish a container image

Build your application's Docker image as part of its CI workflow, then pass the
image to publication.

This builds the project's image. [Custom runner images](../custom-runner-image)
change the environment that runs CI instead.

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with your Dockerfile

Use your application's existing Dockerfile. This example uses a tiny
`FROM scratch` image that copies one file, so the build does not download a base
image:

[`Dockerfile`](./Dockerfile "source {3}")

## Define the actions

Create `.cloudflare/ci/actions.ts`. Each action declares what it needs by calling
the action before it, so Effect CI runs them in order. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source first:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Build the image from the checked-out workspace. The tag is the image name that
publication uses:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=buildImage "source 'docker build --tag effect-ci-custom-image:review .'")

Publish the built image. The example confirms the image exists, then prints a
stand-in for a registry push:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=publishImage "source 'docker image inspect' 'echo docker push'")

For real publication, replace the `echo` with `docker push`, use your registry's
image name in both actions, and configure registry authentication on the host.

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It publishes the image on pull requests,
pushes, and manual runs. Publishing runs the checkout and build first.

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {7-8}")

## Run it

With Docker running:

```sh
cd examples/custom-container-image
effect-ci run
```

## Compare with GitHub Actions

The same three steps as a plain GitHub Actions workflow:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L13-L19 "source")
