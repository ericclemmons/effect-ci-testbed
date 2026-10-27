# Build and run Docker in CI

Build a small project image, run it as an unprivileged user, inspect its resource
limits and remove its container and image. The same action runs against a local
Docker daemon or a private daemon inside a Cloudflare CI container.

## Run locally

Requires Node 24+, Docker with buildx, and a running local Unix-socket daemon.
After the repository's normal install, run from its root:

```sh
cf-ci run --workflow examples/docker-in-docker/.cloudflare/ci/workflow.ts --format=text
```

The unsigned JSON report contains the image ID, actual output, inspected limits and
confirmed cleanup. Expected output: `hello from a user-provided Dockerfile`.
Local mode uses your existing Docker daemon; it does not start a privileged
nested daemon or attach the host socket to the project container.

[Portable action](./.cloudflare/ci/actions.ts#symbol=runImage "source")

[Build/run implementation](./.cloudflare/ci/build-and-run.mjs "source")

[Project Dockerfile](./app/Dockerfile "source")

Each invocation uses unique names and an empty, temporary Docker configuration.
It does not reuse registry credentials, credential helpers or configured proxy
values. Only the Docker endpoint and buildx plugin location are discovered from
the existing configuration. No host environment, socket, credentials or workspace
mount enters the inner container. Its only environment variable is `PATH`.

The inner process has a read-only root filesystem, no capabilities, no privilege
escalation, 128 MiB memory with no swap, 0.25 CPU and 32 PIDs. It checks that the outer
workspace and Docker socket are absent. These checks are not a general security
audit of Docker or a claim that mutually hostile workloads share a safe daemon.

## Run it on Cloudflare

Use your approved account and a dedicated deployment of this recipe. Do not
deploy over the production CI host. From this recipe's directory, after account
setup and compute approval:

```sh
pnpm exec wrangler deploy
pnpm exec wrangler workflows trigger effect-ci-docker-in-docker '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}' --id docker-proof-1
pnpm exec wrangler workflows instances describe effect-ci-docker-in-docker docker-proof-1 --json
```

Use a pushed full commit SHA. This owned fixture accepts only this repository;
forks should change the Worker source policy and deployment names explicitly.
There is no public HTTP execution endpoint and no project-image publication.

[Hosted runner and cleanup](./src/worker.ts "source")

[Deployment configuration](./wrangler.jsonc "source")

The outer image supplies Node, Docker/buildx and the Sandbox shim. Its runner
wrapper adds host networking to inner builds/runs; portable actions contain no
Cloudflare networking flags. Host networking here means the private outer VM,
not an operator machine. Inner containers are **not network-isolated from that
VM**. Do not inject deployment or host-service secrets into this runner.

[Outer image](./Dockerfile "source")

[Runner network policy](./runner/docker.sh "source")

[Daemon startup](./runner/start.sh "source")

[Readiness and diagnostics](./runner/ready.sh "source")

Readiness has a 60-second limit and retains the last 16 KiB of daemon output on
failure. The daemon listens only on its Unix socket. The operation has a
210-second command budget, separate bounded cleanup, and a five-minute action
timeout with no retry. Cleanup removes only that invocation's resources. The
hosted runner uses `standard-1` VMs, a final cleanup checkpoint and a ten-minute
alarm backstop per workspace, including after execution failure. Durable alarms
are a cleanup backstop, not an exact billing cutoff.

An abrupt local process kill can bypass `finally`; inspect this invocation's
named resources before retrying. Hosted cleanup additionally destroys the VM.

The local Container emulator cannot start this nested daemon. Use normal local
Docker for the local action, not `wrangler dev`. Build cache/base-image data may
remain on the local daemon; this recipe never prunes another user's cache. The
hosted VM's daemon state is ephemeral and is destroyed with that VM.

This builds an inner project image; [custom runner images](../custom-runner-image)
configure the outer environment.

See [execution evidence and remaining authority](./verification.md). The feature
matrix remains unchanged until the hosted acceptance criteria pass.
