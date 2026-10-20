# Build and publish a container image

Build your application's Docker image as part of its CI workflow.

The [actions](./.cloudflare/ci/actions.ts) build the project-owned Dockerfile,
then pass the resulting image to publication. The tiny `FROM scratch` fixture
does not download a base image.

## Run it

With Docker running:

```sh
pnpm exec cf-ci run --workflow examples/custom-container-image/.cloudflare/ci/workflow.ts
```

Publication prints a stand-in for a registry push; configure a registry and
host-side authentication for real publication.

This builds the project's image. [Custom runner images](../custom-runner-image)
change the environment that runs CI instead.
