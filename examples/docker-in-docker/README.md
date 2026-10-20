# Build and run Docker in CI

Run a project's Dockerfile inside a Cloudflare CI container.

The outer image supplies Docker and the Sandbox shim. The
[portable actions](./.cloudflare/ci/actions.ts) run:

```sh
docker build --network=host --tag effect-ci-user-image app
docker run --network=host --rm effect-ci-user-image
```

## Run it on Cloudflare

After deploying its [Worker](./src/worker.ts):

```sh
cf workflows instances create effect-ci-docker-in-docker --body '{"params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

Use the Workflow name in your deployed configuration. The local Container
emulator lacks the kernel privileges this nested daemon needs.

This builds an inner project image; [custom runner images](../custom-runner-image)
configure the outer environment.
